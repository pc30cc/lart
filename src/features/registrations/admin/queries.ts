import "server-only"
import { and, asc, count, desc, eq, gt, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm"

import { likePattern, type TableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { courses, members, registrations } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import type { refundTable, RegistrationView, registrationTable } from "./schema"

/**
 * Reads of the super admin's registration pages. Every one starts with
 * `requireAdmin()`; members' contact details never leave the admin panel.
 */

const statusOf: Record<RegistrationView, "pending" | "confirmed" | "cancelled"> = {
  unpaid: "pending",
  paid: "confirmed",
  cancelled: "cancelled",
}

const columns = {
  id: registrations.id,
  participantName: registrations.participantName,
  status: registrations.status,
  amount: registrations.amount,
  paymentMethod: registrations.paymentMethod,
  paidAt: registrations.paidAt,
  cancelledAt: registrations.cancelledAt,
  refundAmount: registrations.refundAmount,
  refundedAt: registrations.refundedAt,
  photoConsent: registrations.photoConsent,
  videoConsent: registrations.videoConsent,
  createdAt: registrations.createdAt,
  member: { name: members.name, email: members.email, phone: members.phone },
}

/** Search a registration by participant, member name, email or phone. */
function search(q: string): SQL | undefined {
  if (!q) return undefined
  const pattern = likePattern(q)
  return or(
    ilike(registrations.participantName, pattern),
    ilike(members.name, pattern),
    ilike(members.email, pattern),
    ilike(members.phone, pattern),
  )
}

type RegistrationParams = TableParams<(typeof registrationTable.sort)[number], keyof typeof registrationTable.filters>

/** One page of a workshop's registrations: filter (paid / not paid / cancelled), search, sort. */
export async function listWorkshopRegistrations(courseId: string, params: RegistrationParams) {
  await requireAdmin()
  const view = params.filters.status as RegistrationView | undefined
  const where = and(
    eq(registrations.courseId, courseId),
    view ? eq(registrations.status, statusOf[view]) : undefined,
    search(params.q),
  )
  const direction = params.dir === "desc" ? desc : asc
  const order =
    params.sort === "participant"
      ? [direction(sql`lower(${registrations.participantName})`), asc(registrations.createdAt)]
      : [direction(registrations.createdAt), asc(registrations.id)]

  const [rows, [{ total }]] = await Promise.all([
    db
      .select(columns)
      .from(registrations)
      .innerJoin(members, eq(members.id, registrations.memberId))
      .where(where)
      .orderBy(...order)
      .limit(params.pageSize)
      .offset(params.offset),
    db
      .select({ total: count() })
      .from(registrations)
      .innerJoin(members, eq(members.id, registrations.memberId))
      .where(where),
  ])
  return { rows, total }
}

export type AdminRegistrationRow = Awaited<ReturnType<typeof listWorkshopRegistrations>>["rows"][number]

const sum = (condition: SQL, value: SQL | typeof registrations.amount = registrations.amount) =>
  sql<number>`coalesce(sum(${value}) filter (where ${condition}), 0)`.mapWith(Number)
const tally = (condition: SQL) => sql<number>`count(*) filter (where ${condition})`.mapWith(Number)

/**
 * The totals above a workshop's registrations: registered (active), paid and
 * not paid yet (people and amounts), cancelled, refunds still owed, and the
 * photo / video consents of the people coming.
 */
export async function registrationSummary(courseId: string) {
  await requireAdmin()
  const pending = sql`${registrations.status} = 'pending'`
  const paid = sql`${registrations.status} = 'confirmed' and ${registrations.amount} > 0`
  const active = sql`${registrations.status} in ('pending', 'confirmed')`
  const owed = sql`${registrations.refundAmount} > 0 and ${registrations.refundedAt} is null`
  const [row] = await db
    .select({
      active: tally(active),
      paid: tally(paid),
      paidAmount: sum(paid),
      unpaid: tally(pending),
      unpaidAmount: sum(pending),
      cancelled: tally(sql`${registrations.status} = 'cancelled'`),
      refundsOwed: tally(owed),
      refundsOwedAmount: sum(owed, sql`${registrations.refundAmount}`),
      photos: tally(sql`${active} and ${registrations.photoConsent}`),
      videos: tally(sql`${active} and ${registrations.videoConsent}`),
    })
    .from(registrations)
    .where(eq(registrations.courseId, courseId))
  return row
}

export type RegistrationSummary = Awaited<ReturnType<typeof registrationSummary>>

/** Every registration of a workshop for the CSV export: active first, then by registration time. */
export async function exportRegistrations(courseId: string) {
  await requireAdmin()
  return db
    .select(columns)
    .from(registrations)
    .innerJoin(members, eq(members.id, registrations.memberId))
    .where(eq(registrations.courseId, courseId))
    .orderBy(sql`${registrations.status} = 'cancelled'`, asc(registrations.createdAt), asc(registrations.id))
}

// ─── Refunds ──────────────────────────────────────────────────────────────────

const owedNow = and(gt(registrations.refundAmount, 0), isNull(registrations.refundedAt))
const paidBack = and(gt(registrations.refundAmount, 0), isNotNull(registrations.refundedAt))

type RefundParams = TableParams<(typeof refundTable.sort)[number], keyof typeof refundTable.filters>

/**
 * Refunds to pay back by hand (default view "owed": refund_amount > 0, not
 * refunded yet), or those already paid back ("refunded"). From the member's
 * own cancellations, an admin's, and cancelled workshops.
 */
export async function listRefunds(params: RefundParams) {
  await requireAdmin()
  const view = params.filters.view === "refunded" ? "refunded" : "owed"
  const where = and(view === "owed" ? owedNow : paidBack, search(params.q))
  const direction = params.dir === "desc" ? desc : asc
  const order =
    params.sort === "amount"
      ? [direction(registrations.refundAmount), asc(registrations.cancelledAt)]
      : view === "refunded"
        ? [direction(registrations.refundedAt), asc(registrations.id)]
        : [direction(registrations.cancelledAt), asc(registrations.id)]

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        ...columns,
        course: {
          id: courses.id,
          title: courses.title,
          startsAt: courses.startsAt,
          status: courses.status,
          cancelledAt: courses.cancelledAt,
        },
      })
      .from(registrations)
      .innerJoin(members, eq(members.id, registrations.memberId))
      .innerJoin(courses, eq(courses.id, registrations.courseId))
      .where(where)
      .orderBy(...order)
      .limit(params.pageSize)
      .offset(params.offset),
    db
      .select({ total: count() })
      .from(registrations)
      .innerJoin(members, eq(members.id, registrations.memberId))
      .where(where),
  ])
  return { view, rows, total }
}

export type RefundRow = Awaited<ReturnType<typeof listRefunds>>["rows"][number]

/** How many refunds are still owed, and how much in all. */
export async function refundsOwed() {
  await requireAdmin()
  const [row] = await db
    .select({ count: count(), amount: sql<number>`coalesce(sum(${registrations.refundAmount}), 0)`.mapWith(Number) })
    .from(registrations)
    .where(owedNow)
  return row
}

/** Why a refund is owed: the workshop was cancelled, or just this registration. */
export function refundReason(row: Pick<RefundRow, "cancelledAt" | "course">): "workshopCancelled" | "registrationCancelled" {
  const { course } = row
  const workshopCancelled =
    (course.status === "cancelled" || course.cancelledAt !== null) &&
    row.cancelledAt !== null &&
    course.cancelledAt !== null &&
    row.cancelledAt.getTime() === course.cancelledAt.getTime()
  return workshopCancelled ? "workshopCancelled" : "registrationCancelled"
}
