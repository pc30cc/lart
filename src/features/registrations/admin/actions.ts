"use server"

import { refresh, revalidatePath } from "next/cache"
import { after } from "next/server"

import { db } from "@/db"
import { paymentSettingsSchema } from "@/features/settings/payments"
import { refreshAdminNotices } from "@/features/telegram/admin-notices"
import { adminAction } from "@/lib/action"
import { changes } from "@/lib/audit"
import { errorForLog, UserError } from "@/lib/errors"
import { getSetting, setSetting } from "@/lib/settings"
import { sendPaymentReceived, sendRefundChanged, sendRefundSent, sendRegistrationCancelled } from "./notify"
import { cancelRegistration, momentOf, recordPayment, recordRefund, setRefund } from "./payments"
import { sendRegistrationReceived } from "../notify"
import { changeHold, holdSeats, releaseHold } from "./holds"
import { registerByAdmin, searchMembers } from "./register"
import { changeHoldSchema, holdSeatsSchema, releaseHoldSchema } from "./schema"
import { addRegistrationSchema, cancelRegistrationSchema, markRefundedSchema, memberSearchSchema, recordPaymentSchema, setRefundSchema } from "./schema"

/**
 * The super admin's registration actions: record a payment, cancel a
 * registration, change a refund, mark a refund as paid back, and the payment
 * settings. Each
 * change and its audit entry share one transaction; the member's email goes
 * out after the response (`after`), in the member's language.
 */

const logFailure = (what: string) => (err: unknown) => console.error(`[registrations] ${what} failed`, errorForLog(err))

/** Money moved: the workshop pages, the wallet and the dashboard show it. */
function revalidate() {
  revalidatePath("/[locale]/admin", "layout")
  refresh()
}

/** "Record payment" of a registration not paid yet (cash, bank transfer or the online link). */
export const recordPaymentAction = adminAction(recordPaymentSchema, async ({ id, method, amount, paidOn }, ctx) => {
  await db.transaction(async (tx) => {
    const paid = await recordPayment(tx, { registrationId: id, method, amount, paidAt: momentOf(paidOn), createdBy: ctx.admin.id })
    await ctx.audit(
      {
        action: "registration.payment",
        entity: "registration",
        entityId: id,
        data: { courseId: paid.courseId, method, amount: paid.amount, paidOn, transactionId: paid.transactionId },
      },
      tx,
    )
  })
  after(() => sendPaymentReceived(id, method).catch(logFailure("payment email")))
  // The admins' Telegram cards of this registration now say it is paid.
  after(() => refreshAdminNotices(id))
  revalidate()
  return { id, method }
})

/**
 * "Add registration": a member registered by a super admin for a workshop
 * (and day), not paid yet or paid. The member is emailed like after their own
 * registration ("your place is reserved", or "we received your payment").
 */
export const addRegistrationAction = adminAction(addRegistrationSchema, async (input, ctx) => {
  const added = await db.transaction(async (tx) => {
    // On a place held for guests: the hold gives that place first (same workshop, its day).
    if (input.holdId) {
      const hold = await changeHold(tx, input.holdId, -1)
      if (hold.courseId !== input.courseId) throw new UserError("workshops.registrations.holds.errors.gone")
      input = { ...input, day: hold.day ?? undefined }
      await ctx.audit({ action: "registration.release", entity: "workshop", entityId: hold.courseId, data: { count: 1, day: hold.day, note: hold.note, registered: true } }, tx)
    }
    const added = await registerByAdmin(tx, input, ctx.admin.id)
    await ctx.audit(
      {
        action: "registration.added",
        entity: "registration",
        entityId: added.id,
        data: { courseId: added.courseId, memberId: input.memberId, day: input.day ?? null, paid: added.paid, method: added.paid ? input.method : null },
      },
      tx,
    )
    return added
  })
  after(() =>
    (added.paid && input.method ? sendPaymentReceived(added.id, input.method) : sendRegistrationReceived(added.id)).catch(logFailure("registration email")),
  )
  revalidate()
  return { id: added.id, courseId: added.courseId }
})

/** The member search of "Add registration" (name, email or phone). */
export const searchMembersAction = adminAction(memberSearchSchema, async ({ q }) => searchMembers(q))

/** Cancel a registration; a paid one is owed its refund (under the terms, or in full). */
export const cancelRegistrationAction = adminAction(cancelRegistrationSchema, async ({ id, refund }, ctx) => {
  const cancelled = await db.transaction(async (tx) => {
    const cancelled = await cancelRegistration(tx, { registrationId: id, refund })
    await ctx.audit(
      {
        action: "registration.cancel",
        entity: "registration",
        entityId: id,
        data: {
          courseId: cancelled.courseId,
          paid: cancelled.paid,
          refundChoice: refund,
          refundPercent: cancelled.percent,
          refundAmount: cancelled.refund,
        },
      },
      tx,
    )
    return cancelled
  })
  after(() => sendRegistrationCancelled(cancelled).catch(logFailure("cancellation email")))
  revalidate()
  return { id, refund: cancelled.refund }
})

/**
 * Confirm or change the refund of a cancelled, paid registration before it is
 * paid back (e.g. in full when the workshop's date, venue or instructor
 * changed). Unchanged: nothing is written. Changed: audited, and the member
 * is told the new refund.
 */
export const setRefundAction = adminAction(setRefundSchema, async ({ id, amount }, ctx) => {
  const changed = await db.transaction(async (tx) => {
    const changed = await setRefund(tx, { registrationId: id, amount })
    if (changed.to !== changed.from) {
      await ctx.audit(
        {
          action: "registration.refundChange",
          entity: "registration",
          entityId: id,
          data: { courseId: changed.courseId, paid: changed.paid, from: changed.from, to: changed.to },
        },
        tx,
      )
    }
    return changed
  })
  if (changed.to === changed.from) return { id, amount: changed.to, changed: false }
  after(() => sendRefundChanged(changed).catch(logFailure("refund change email")))
  revalidate()
  return { id, amount: changed.to, changed: true }
})

/** A refund owed was paid back by hand: posted to the ledger once, then "Your refund is on its way". */
export const markRefundedAction = adminAction(markRefundedSchema, async ({ id, method, refundedOn }, ctx) => {
  const refunded = await db.transaction(async (tx) => {
    const refunded = await recordRefund(tx, { registrationId: id, refundedAt: momentOf(refundedOn), createdBy: ctx.admin.id })
    await ctx.audit(
      {
        action: "registration.refund",
        entity: "registration",
        entityId: id,
        data: { courseId: refunded.courseId, amount: refunded.amount, method, refundedOn, transactionId: refunded.transactionId },
      },
      tx,
    )
    return refunded
  })
  after(() => sendRefundSent(id).catch(logFailure("refund email")))
  revalidate()
  return { id, amount: refunded.amount }
})

/** Settings → Payments: which ways to pay are on, the bank account and the notes. */
export const savePaymentSettings = adminAction(paymentSettingsSchema, async (input, ctx) => {
  const before = await getSetting("payment")
  const diff = changes(before, input)
  if (Object.keys(diff).length === 0) return { changed: false }
  await db.transaction(async (tx) => {
    await setSetting("payment", input, tx)
    await ctx.audit({ action: "setting.update", entity: "setting", entityId: "payment", data: diff }, tx)
  })
  revalidate()
  return { changed: true }
})

/** "Hold places" for guests: taken on the site like registrations, no money (`holdSeats`). Audited "registration.hold". */
export const holdSeatsAction = adminAction(holdSeatsSchema, async (input, ctx) => {
  const held = await db.transaction(async (tx) => {
    const held = await holdSeats(tx, input, ctx.admin.id)
    await ctx.audit(
      { action: "registration.hold", entity: "workshop", entityId: input.courseId, data: { count: input.count, day: held.day, note: input.note, invited: input.invited } },
      tx,
    )
    return held
  })
  revalidate()
  return held
})

/** Free the places of a hold, so people can register for them. Audited "registration.release". */
export const releaseHoldAction = adminAction(releaseHoldSchema, async ({ id }, ctx) => {
  await db.transaction(async (tx) => {
    const row = await releaseHold(tx, id)
    await ctx.audit(
      { action: "registration.release", entity: "workshop", entityId: row.courseId, data: { count: row.count, day: row.day, note: row.note } },
      tx,
    )
  })
  revalidate()
})

/** One place more (+1) or less (−1, at 0 the hold is gone) in a hold. Audited "registration.hold" / "registration.release" with the place. */
export const changeHoldAction = adminAction(changeHoldSchema, async ({ id, delta }, ctx) => {
  await db.transaction(async (tx) => {
    const hold = await changeHold(tx, id, delta)
    await ctx.audit(
      { action: delta > 0 ? "registration.hold" : "registration.release", entity: "workshop", entityId: hold.courseId, data: { count: 1, day: hold.day, note: hold.note, total: hold.count } },
      tx,
    )
  })
  revalidate()
})
