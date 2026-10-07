import "server-only"
import { and, eq, isNull } from "drizzle-orm"

import type { Tx } from "@/db"
import { courses, registrations } from "@/db/schema"
import { booksClosed, lockCourse, postRegistrationPayment, postRegistrationRefund, today } from "@/features/money/ledger"
import { UserError } from "@/lib/errors"
import { zonedToIso } from "@/lib/format"
import { refundAmount, refundPercent, type RefundPercent } from "../refund-policy"
import type { PaymentMethod } from "./schema"

/**
 * The money side of one registration, in ONE place: a payment is recorded
 * (`recordPayment`), a registration is cancelled with the refund it is owed
 * (`cancelRegistration`), the admin confirms or changes that refund
 * (`setRefund`), and a refund is marked as paid back (`recordRefund`). Each runs inside the caller's transaction, locks the
 * workshop first and then the registration (the lock order of
 * features/money/ledger, the member's own register / cancel and
 * cancelWorkshop), checks the state under those locks and posts the ledger
 * entry in the same transaction. Expected refusals are `UserError`s.
 *
 * Today an admin records every payment. A payment gateway (a later phase)
 * calls `recordPayment` with its own amount and time and `createdBy: null`.
 */

const E = "workshops.registrations.errors"

/** Lock the registration (its workshop first) and read what the checks need. */
async function lock(tx: Tx, registrationId: string) {
  const [ref] = await tx
    .select({ courseId: registrations.courseId })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
  if (!ref) throw new UserError(`${E}.notFound`)
  const course = await lockCourse(tx, ref.courseId)
  const [reg] = await tx
    .select({
      id: registrations.id,
      courseId: registrations.courseId,
      memberId: registrations.memberId,
      status: registrations.status,
      amount: registrations.amount,
      createdAt: registrations.createdAt,
      paidAt: registrations.paidAt,
      refundAmount: registrations.refundAmount,
      refundedAt: registrations.refundedAt,
    })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .for("update")
  if (!reg) throw new UserError(`${E}.notFound`)
  return { course, reg }
}

export type RecordPaymentInput = {
  registrationId: string
  method: PaymentMethod
  /** The amount received, in kuruş: exactly the registration's amount (no part payments). */
  amount: number
  /** When it was paid. Not in the future, not before the registration. */
  paidAt: Date
  /** The admin who recorded it; null for an automatic payment (a gateway). */
  createdBy: string | null
}

export type RecordedPayment = {
  registrationId: string
  courseId: string
  memberId: string
  amount: number
  method: PaymentMethod
  paidAt: Date
  transactionId: string
}

/**
 * A registration that is not paid yet ("pending") is paid: it becomes
 * "confirmed" with `paid_at` and `payment_method`, and the income is posted
 * to the wallet (`registration_payment`), all in the caller's transaction.
 * Refused politely when it is already paid, cancelled, free, the amount
 * differs, or the workshop's books are closed. Safe to call twice: the second
 * call finds it paid (the row lock makes the second one wait for the first),
 * and the ledger refuses a second payment of the same registration too.
 */
export async function recordPayment(tx: Tx, input: RecordPaymentInput, now: Date = new Date()): Promise<RecordedPayment> {
  const { course, reg } = await lock(tx, input.registrationId)
  if (reg.status === "confirmed") throw new UserError(reg.amount > 0 ? `${E}.alreadyPaid` : `${E}.nothingToPay`)
  if (reg.status === "cancelled") throw new UserError(`${E}.cancelledNoPayment`)
  if (reg.amount <= 0) throw new UserError(`${E}.nothingToPay`)
  if (booksClosed(course)) throw new UserError("money.errors.workshopClosed")
  if (input.amount !== reg.amount) throw new UserError(`${E}.amountChanged`)
  if (input.paidAt.getTime() > now.getTime() + 5 * 60_000) throw new UserError("money.validation.notInFuture", { field: "paidOn" })
  if (today(input.paidAt) < today(reg.createdAt)) throw new UserError(`${E}.paidBeforeRegistration`, { field: "paidOn" })

  await tx
    .update(registrations)
    .set({ status: "confirmed", paidAt: input.paidAt, paymentMethod: input.method })
    .where(and(eq(registrations.id, reg.id), eq(registrations.status, "pending")))
  const transactionId = await postRegistrationPayment(tx, {
    registrationId: reg.id,
    occurredOn: today(input.paidAt),
    createdBy: input.createdBy,
  })
  return {
    registrationId: reg.id,
    courseId: reg.courseId,
    memberId: reg.memberId,
    amount: reg.amount,
    method: input.method,
    paidAt: input.paidAt,
    transactionId,
  }
}

export type CancelledRegistration = {
  registrationId: string
  courseId: string
  memberId: string
  /** What was paid (0: not paid yet, or a free workshop). */
  paid: number
  /** The share refunded: 100 for a full refund, else the terms' band. */
  percent: RefundPercent
  /** Owed back to the payer, in kuruş (refund_amount). */
  refund: number
}

/**
 * An admin cancels an active registration (until the workshop's books are
 * closed). Not paid yet: nothing is owed. Paid: the refund under the terms
 * (100 / 50 / 0 % by the time left before the start, refund-policy.ts) or,
 * by the admin's choice, in full. The refund is stored as `refund_amount`
 * and appears in Money → Refunds until it is marked as paid back. `paid_at`
 * stays, as the record of the payment.
 */
export async function cancelRegistration(
  tx: Tx,
  input: { registrationId: string; refund: "terms" | "full" },
  now: Date = new Date(),
): Promise<CancelledRegistration> {
  const { course, reg } = await lock(tx, input.registrationId)
  if (reg.status === "cancelled") throw new UserError(`${E}.alreadyCancelled`)
  if (booksClosed(course)) throw new UserError("money.errors.workshopClosed")
  const [{ startsAt }] = await tx.select({ startsAt: courses.startsAt }).from(courses).where(eq(courses.id, reg.courseId))

  const paid = reg.status === "confirmed" ? reg.amount : 0
  const full = input.refund === "full"
  const percent: RefundPercent = full ? 100 : refundPercent(startsAt, now)
  const refund = paid > 0 ? (full ? paid : refundAmount(paid, startsAt, now)) : 0

  await tx
    .update(registrations)
    .set({ status: "cancelled", cancelledAt: now, refundAmount: refund })
    .where(eq(registrations.id, reg.id))
  return { registrationId: reg.id, courseId: reg.courseId, memberId: reg.memberId, paid, percent, refund }
}

export type RecordedRefund = {
  registrationId: string
  courseId: string
  memberId: string
  amount: number
  refundedAt: Date
  transactionId: string
}

/**
 * The refund owed on a cancelled registration was paid back by hand: posts
 * `registration_refund` (revenue back out of the wallet) on that day and sets
 * `refunded_at`. The day is not in the future and not before the payment.
 * Never twice: refused when it is already marked (the row
 * lock makes a second call wait and then see it), and the ledger never pays
 * back more than was paid.
 */
export async function recordRefund(
  tx: Tx,
  input: { registrationId: string; refundedAt: Date; createdBy: string | null },
  now: Date = new Date(),
): Promise<RecordedRefund> {
  const { course, reg } = await lock(tx, input.registrationId)
  if (reg.refundedAt) throw new UserError("money.refunds.errors.alreadyRefunded")
  if (reg.status !== "cancelled" || !reg.refundAmount || reg.refundAmount <= 0) {
    throw new UserError("money.refunds.errors.nothingOwed")
  }
  if (booksClosed(course)) throw new UserError("money.errors.workshopClosed")
  if (input.refundedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new UserError("money.validation.notInFuture", { field: "refundedOn" })
  }
  // Not before the day the money came in (Istanbul days, as `recordPayment`), or an earlier period's figures would change.
  if (reg.paidAt && today(input.refundedAt) < today(reg.paidAt)) {
    throw new UserError("money.refunds.errors.beforePayment", { field: "refundedOn" })
  }

  const transactionId = await postRegistrationRefund(tx, {
    registrationId: reg.id,
    amount: reg.refundAmount,
    occurredOn: today(input.refundedAt),
    createdBy: input.createdBy,
  })
  await tx
    .update(registrations)
    .set({ refundedAt: input.refundedAt })
    .where(and(eq(registrations.id, reg.id), isNull(registrations.refundedAt)))
  return {
    registrationId: reg.id,
    courseId: reg.courseId,
    memberId: reg.memberId,
    amount: reg.refundAmount,
    refundedAt: input.refundedAt,
    transactionId,
  }
}

export type ChangedRefund = {
  registrationId: string
  courseId: string
  memberId: string
  /** What was paid, in kuruş. */
  paid: number
  /** The refund owed before and after the change, in kuruş. */
  from: number
  to: number
}

/**
 * The admin confirms or changes the refund owed on a cancelled, paid
 * registration before it is paid back: e.g. a full refund instead of the
 * terms' 50 % when the workshop's date, venue or instructor changed, or a
 * 0 % cancellation the admin still wants to refund. Any amount from 0 up to
 * what was paid; it is stored as `refund_amount` (Money → Refunds lists it
 * while it is above 0). Refused once the refund is marked as paid back, for
 * a registration that is not cancelled or was never paid, and once the
 * workshop's books are closed.
 */
export async function setRefund(tx: Tx, input: { registrationId: string; amount: number }): Promise<ChangedRefund> {
  const { course, reg } = await lock(tx, input.registrationId)
  if (reg.refundedAt) throw new UserError("money.refunds.errors.alreadyRefunded")
  if (reg.status !== "cancelled" || !reg.paidAt || reg.amount <= 0) throw new UserError("money.refunds.errors.nothingOwed")
  if (booksClosed(course)) throw new UserError("money.errors.workshopClosed")
  if (input.amount > reg.amount) throw new UserError("money.errors.moreThanPaid", { field: "amount" })

  const from = reg.refundAmount ?? 0
  if (input.amount !== from) {
    await tx.update(registrations).set({ refundAmount: input.amount }).where(eq(registrations.id, reg.id))
  }
  return { registrationId: reg.id, courseId: reg.courseId, memberId: reg.memberId, paid: reg.amount, from, to: input.amount }
}

/** The moment to store for a day the admin picked ("YYYY-MM-DD"): now for today, else midday of that day in Istanbul. */
export function momentOf(day: string, now: Date = new Date()): Date {
  const midday = zonedToIso(day, "12:00")
  return day === today(now) || !midday ? now : new Date(midday)
}
