import "server-only"
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm"

import { db, type Tx } from "@/db"
import {
  admins,
  categories,
  courses,
  instructors,
  ledgerLines,
  ledgerTransactions,
  registrations,
  templates,
} from "@/db/schema"
import { partnerCapitals, walletBalance } from "@/features/money/ledger"
import { requireAdmin } from "@/lib/auth/admin"
import { zonedParts, zonedToIso } from "@/lib/format"
import { publicUrls } from "@/lib/storage"
import { addMonths, change, fillMonths, fillRate, lastMonths, paymentNote, workshopAlert } from "./metrics"

/**
 * Everything the dashboard shows, in a handful of SQL aggregates.
 *
 * Money figures follow profit and loss by period (features/money/reports):
 * ledger amounts are debit-positive, so revenue is minus the sum of its lines;
 * closing entries are left out (they only move a closed workshop's result to
 * the partners' capital). An instructor fee is booked by the settlement, dated
 * on the day its workshop is closed, so a past month never changes, but the
 * fee of a confirmed workshop not closed yet is not counted anywhere (the UI
 * says so). "Last 12 months" is the current month and the 11 before it, in
 * Istanbul time.
 */

type Exec = typeof db | Tx

const UPCOMING = 6
const HELD = 4
const RANKED = 8

const active = ["awaiting_signature", "published", "confirmed"] as const
/**
 * Took place: confirmed or closed, and over. A cancelled workshop keeps its
 * cancelled_at when it is closed (to book its costs), so it never counts as held.
 */
const tookPlace = (now: Date) =>
  and(inArray(courses.status, ["confirmed", "closed"]), isNull(courses.cancelledAt), lt(courses.endsAt, now))
const amount = ledgerLines.amount
const n = (cond: SQL | undefined) => sql<number>`count(*) filter (where ${cond})`.mapWith(Number)
const total = (expr: unknown, cond: SQL | undefined) => sql<number>`coalesce(sum(${expr}) filter (where ${cond}), 0)`.mapWith(Number)

/** The outer query's course id, qualified by hand (see the Drizzle note in docs/DEVELOPMENT.md). */
const courseId = sql`${courses}.${sql.identifier(courses.id.name)}`
/**
 * Registrations of the course in the outer query. "Registered" means every
 * active one, paid ("confirmed") or not paid yet ("pending"), as the seats
 * left on the site and the admin's fill columns count them: the upcoming
 * meters use it, live, also after the go decision. "Paid" means confirmed
 * with an amount above 0, as on the registrations tab: a free registration
 * (confirmed at once, amount 0) is not counted as paid.
 */
const registeredCount = sql<number>`(select count(*) from ${registrations} r where r.course_id = ${courseId} and r.status in ('pending', 'confirmed'))`.mapWith(Number)
const paidCount = sql<number>`(select count(*) from ${registrations} r where r.course_id = ${courseId} and r.status = 'confirmed' and r.amount > 0)`.mapWith(Number)

/**
 * Participants of a workshop that took place (the held figures): locked at
 * closing, fixed at the go decision, otherwise everyone registered (paid or
 * not yet). Upcoming workshops use the live registered count instead.
 */
function participants(registered: unknown) {
  return sql<number>`case
    when ${courses.status} = 'closed' then coalesce((${courses.closedTotals}->>'participants')::int, 0)
    when ${courses.status} = 'cancelled' then 0
    else coalesce(${courses.finalParticipants}, ${registered}, 0) end`
}
const netProfit = sql<number>`coalesce((${courses.closedTotals}->>'netProfit')::bigint, 0)`

type Results<T extends readonly (() => unknown)[]> = { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }

/** Run reads side by side on the pool; one after another inside a transaction (a single connection). */
async function gather<const T extends readonly (() => unknown)[]>(exec: Exec, tasks: T): Promise<Results<T>> {
  if (exec === db) return (await Promise.all(tasks.map((task) => task()))) as Results<T>
  const out: unknown[] = []
  for (const task of tasks) out.push(await task())
  return out as Results<T>
}

/** Income and expenses per month (closing entries left out), dated from `from` up to (not including) `until`. */
function monthly(exec: Exec, from: string, until: string) {
  const t = ledgerTransactions
  const month = sql<string>`to_char(date_trunc('month', ${t.occurredOn}::timestamp), 'YYYY-MM-DD')`
  return exec
    .select({
      month,
      revenue: sql<number>`coalesce(-sum(${amount}) filter (where ${ledgerLines.account} = 'revenue'), 0)`.mapWith(Number),
      expenses: sql<number>`coalesce(sum(${amount}) filter (where ${ledgerLines.account} <> 'revenue'), 0)`.mapWith(Number),
    })
    .from(ledgerLines)
    .innerJoin(t, eq(t.id, ledgerLines.transactionId))
    .where(
      and(
        ne(t.kind, "course_close"),
        inArray(ledgerLines.account, ["revenue", "instructor_fees", "course_expenses", "general_expenses"]),
        gte(t.occurredOn, from),
        lt(t.occurredOn, until),
      ),
    )
    .groupBy(month)
}

/** Counts for the cards, the attention strip and the first-steps guide: one pass over the workshops. */
async function summary(exec: Exec, now: Date, windowStart: Date) {
  const regs = exec
    .select({
      courseId: registrations.courseId,
      registered: sql<number>`count(*) filter (where ${registrations.status} in ('pending', 'confirmed'))`.as("registered"),
    })
    .from(registrations)
    .groupBy(registrations.courseId)
    .as("regs")
  /** Held workshops: the participant figure (locked or fixed at the go decision). */
  const taken = participants(regs.registered)
  const upcoming = and(inArray(courses.status, active), gte(courses.endsAt, now))
  const open = and(upcoming, ne(courses.status, "awaiting_signature"))
  const held = and(tookPlace(now), gte(courses.startsAt, windowStart))

  const [row] = await exec
    .select({
      workshops: count(),
      upcoming: n(upcoming),
      upcomingSeats: total(courses.maxCapacity, open),
      // Live, as the upcoming meters and the seats left on the site.
      upcomingTaken: total(sql`coalesce(${regs.registered}, 0)`, open),
      held: n(held),
      heldSeats: total(courses.maxCapacity, held),
      heldTaken: total(taken, held),
      awaitingSignature: n(eq(courses.status, "awaiting_signature")),
      decisionsDue: n(and(eq(courses.status, "published"), lte(courses.decisionAt, now))),
      // As workshopsToClose: a cancelled workshop stays "cancelled" once closed, with closed_at set.
      toClose: n(or(and(eq(courses.status, "confirmed"), lte(courses.endsAt, now)), and(eq(courses.status, "cancelled"), isNull(courses.closedAt)))),
      categories: sql<number>`(select count(*) from ${categories})`.mapWith(Number),
      instructors: sql<number>`(select count(*) from ${instructors})`.mapWith(Number),
      contract: sql<boolean>`exists (select 1 from ${templates} where kind = 'contract' and is_default)`,
      ledger: sql<boolean>`exists (select 1 from ${ledgerTransactions})`,
    })
    .from(courses)
    .leftJoin(regs, eq(regs.courseId, courses.id))
  return row
}

/** The next workshops (running now included), soonest first. */
function upcomingWorkshops(exec: Exec, now: Date) {
  return exec
    .select({
      id: courses.id,
      status: courses.status,
      title: courses.title,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
      decisionAt: courses.decisionAt,
      minCapacity: courses.minCapacity,
      maxCapacity: courses.maxCapacity,
      /** Everyone registered now, paid or not yet (also after the go decision). */
      registered: registeredCount,
      /** Of those registered now, how many have paid (a free workshop: none). */
      paid: paidCount,
      price: courses.price,
      /** The number fixed at the go decision (confirmed workshops), or null. */
      finalParticipants: courses.finalParticipants,
      instructor: instructors.displayName,
    })
    .from(courses)
    .innerJoin(instructors, eq(instructors.id, courses.instructorId))
    .where(and(inArray(courses.status, active), gte(courses.endsAt, now)))
    .orderBy(asc(courses.startsAt), asc(courses.id))
    .limit(UPCOMING)
}

/** The last workshops that took place, most recent first. */
function heldWorkshops(exec: Exec, now: Date) {
  return exec
    .select({
      id: courses.id,
      title: courses.title,
      startsAt: courses.startsAt,
      minCapacity: courses.minCapacity,
      maxCapacity: courses.maxCapacity,
      registered: participants(registeredCount).mapWith(Number),
    })
    .from(courses)
    .where(tookPlace(now))
    .orderBy(desc(courses.startsAt), desc(courses.id))
    .limit(HELD)
}

/** Closed in the window: held ("closed") or cancelled with its costs booked ("cancelled", closed_at set). */
const closedSince = (windowStart: Date) => and(isNotNull(courses.closedAt), gte(courses.startsAt, windowStart))

/** Locked results of the workshops closed in the window, most recent first. */
function profitByWorkshop(exec: Exec, windowStart: Date) {
  return exec
    .select({
      id: courses.id,
      title: courses.title,
      startsAt: courses.startsAt,
      instructor: instructors.displayName,
      netProfit: netProfit.mapWith(Number),
    })
    .from(courses)
    .innerJoin(instructors, eq(instructors.id, courses.instructorId))
    .where(closedSince(windowStart))
    .orderBy(desc(courses.startsAt), desc(courses.id))
    .limit(RANKED)
}

/** The same results added up per instructor, best first. */
function profitByInstructor(exec: Exec, windowStart: Date) {
  const sum = sql<number>`sum(${netProfit})`.mapWith(Number)
  return exec
    .select({ id: instructors.id, name: instructors.displayName, workshops: count(), netProfit: sum })
    .from(courses)
    .innerJoin(instructors, eq(instructors.id, courses.instructorId))
    .where(closedSince(windowStart))
    .groupBy(instructors.id)
    .orderBy(desc(sum), asc(instructors.id))
    .limit(RANKED)
}

/** Partners: active admins, and former ones who still have capital. Oldest first, so colours never move. */
async function partners(exec: Exec) {
  const [people, capitals, url] = await gather(exec, [
    () =>
      exec
        .select({
          id: admins.id,
          name: admins.name,
          shareBp: admins.shareBp,
          active: admins.active,
          photoPath: admins.photoPath,
        })
        .from(admins)
        .orderBy(asc(admins.createdAt), asc(admins.id)),
    () => partnerCapitals(exec),
    () => publicUrls(),
  ])
  return people
    .filter((p) => p.active || capitals.has(p.id))
    .map(({ photoPath, ...p }) => ({
      ...p,
      shareBp: p.active ? p.shareBp : 0,
      capital: capitals.get(p.id)?.capital ?? 0,
      photoUrl: url(photoPath),
    }))
}

/**
 * The dashboard. `now` and `exec` are for tests (a fixed clock, a transaction
 * that is rolled back afterwards).
 */
export async function getDashboard(now: Date = new Date(), exec: Exec = db) {
  await requireAdmin()
  const today = zonedParts(now).date
  const months = lastMonths(today)
  const windowStart = new Date(zonedToIso(months[0], "00:00")!)

  const [monthRows, wallet, counts, upcomingRows, heldRows, byWorkshop, byInstructor, people] = await gather(exec, [
    () => monthly(exec, months[0], addMonths(today, 1)),
    () => walletBalance(exec),
    () => summary(exec, now, windowStart),
    () => upcomingWorkshops(exec, now),
    () => heldWorkshops(exec, now),
    () => profitByWorkshop(exec, windowStart),
    () => profitByInstructor(exec, windowStart),
    () => partners(exec),
  ])

  const figures = fillMonths(months, monthRows)
  const [lastMonth, thisMonth] = figures.slice(-2)
  const year = today.slice(0, 4)
  const upcoming = upcomingRows.map((w) => ({
    ...w,
    running: w.startsAt <= now,
    alert: workshopAlert(w, now),
    payment: paymentNote(w),
  }))

  return {
    today,
    year: Number(year),
    /** No workshop yet: show the first-steps guide. */
    fresh: counts.workshops === 0,
    /** Nothing at all yet (no workshop, no money): the guide alone. */
    blank: counts.workshops === 0 && !counts.ledger,
    setup: {
      categories: counts.categories,
      instructors: counts.instructors,
      workshops: counts.workshops,
      /** A default contract text exists (a workshop needs it). */
      contract: Boolean(counts.contract),
      ledger: Boolean(counts.ledger),
    },
    kpis: {
      wallet,
      revenueThisMonth: thisMonth.revenue,
      revenueLastMonth: lastMonth.revenue,
      revenueChange: change(thisMonth.revenue, lastMonth.revenue),
      netThisYear: figures.filter((m) => m.month.startsWith(year)).reduce((s, m) => s + m.net, 0),
      upcoming: counts.upcoming,
      upcomingSeats: counts.upcomingSeats,
      upcomingTaken: counts.upcomingTaken,
      held: counts.held,
      heldSeats: counts.heldSeats,
      heldTaken: counts.heldTaken,
      fillRate: fillRate(counts.heldTaken, counts.heldSeats),
    },
    attention: { decisionsDue: counts.decisionsDue, awaitingSignature: counts.awaitingSignature, toClose: counts.toClose },
    months: figures,
    partners: people,
    upcoming,
    /** Recent and upcoming workshops, oldest first (registration is not open while awaiting signature). */
    seats: [
      ...[...heldRows].reverse().map((w) => ({ ...w, upcoming: false })),
      ...upcomingRows
        .filter((w) => w.status !== "awaiting_signature")
        .map(({ id, title, startsAt, minCapacity, maxCapacity, registered: taken }) => ({
          id, title, startsAt, minCapacity, maxCapacity, registered: taken, upcoming: true,
        })),
    ],
    profit: { workshops: byWorkshop, instructors: byInstructor },
  }
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>
export type UpcomingWorkshop = Dashboard["upcoming"][number]
export type SeatRow = Dashboard["seats"][number]
export type PartnerRow = Dashboard["partners"][number]
