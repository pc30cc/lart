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
import { registeredOf, seatsTakenOf } from "@/features/registrations/public"
import { workshopDays, type StoredDays } from "@/features/workshops/days"
import { requireAdmin } from "@/lib/auth/admin"
import { calendarFields, periodStart } from "@/lib/calendar"
import { zonedParts, zonedToIso, type CalendarSystem } from "@/lib/format"
import { publicUrls } from "@/lib/storage"
import { addMonths, change, fillMonths, fillRate, lastMonths, MONTHS, monthOf, paymentNote, workshopAlert } from "./metrics"

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
/**
 * Places on all the days of the course in the outer query, as `workshopDays`
 * counts them: the first day has the workshop's own, every other day its own
 * or the same.
 */
const allDaysSeats = sql<number>`(${courses.maxCapacity} + coalesce((select sum(coalesce((e.d->>'maxCapacity')::int, ${courses.maxCapacity}))
  from jsonb_array_elements(case when jsonb_typeof(${courses.days}) = 'array' then ${courses.days} end) with ordinality e(d, i) where e.i > 1), 0))`

type DaysOf = { startsAt: Date; endsAt: Date; days: StoredDays; minCapacity: number; maxCapacity: number }

/**
 * Each day of a workshop (one for a one-day workshop) with its places:
 * `taken` counts registrations and held places, as the site and the
 * workshops list do; `registered` the registrations alone, which the go
 * decision counts against the minimum; `min` and `max` are that day's.
 * `session`: all the days are on one date (sessions, named by their hours);
 * `sharedDate`: another day is on this one's date.
 */
function placesOf(w: DaysOf, taken: number[] | undefined, registered?: number[]) {
  const days = workshopDays(w)
  const date = (d: Date) => zonedParts(d).date
  const session = days.every((d) => date(d.startsAt) === date(days[0].startsAt))
  return days.map((d, i) => ({
    n: i + 1,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    min: d.minCapacity ?? w.minCapacity,
    max: d.maxCapacity ?? w.maxCapacity,
    taken: taken?.[i] ?? 0,
    registered: registered?.[i] ?? 0,
    session,
    sharedDate: days.some((o, j) => j !== i && date(o.startsAt) === date(d.startsAt)),
  }))
}
export type Place = ReturnType<typeof placesOf>[number]

/** A bar of the seats chart: a workshop, or one day of an upcoming one on several days (`place`). */
type SeatBar = {
  id: string
  workshopId: string
  title: (typeof courses.$inferSelect)["title"]
  startsAt: Date
  minCapacity: number
  maxCapacity: number
  registered: number
  upcoming: boolean
  place: Place | null
}

const sumOf = <T>(rows: T[], f: (row: T) => number) => rows.reduce((s, row) => s + f(row), 0)

type Results<T extends readonly (() => unknown)[]> = { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }

/** Run reads side by side on the pool; one after another inside a transaction (a single connection). */
async function gather<const T extends readonly (() => unknown)[]>(exec: Exec, tasks: T): Promise<Results<T>> {
  if (exec === db) return (await Promise.all(tasks.map((task) => task()))) as Results<T>
  const out: unknown[] = []
  for (const task of tasks) out.push(await task())
  return out as Results<T>
}

/**
 * Income and expenses per month (closing entries left out), dated from the
 * first of `months` (first days, oldest first) up to (not including) `until`.
 * The database sums each day; the days are put into the months here, so the
 * months can be the viewer's calendar's (Persian: Solar Hijri months).
 */
async function monthly(exec: Exec, months: string[], until: string) {
  const t = ledgerTransactions
  const days = await exec
    .select({
      day: t.occurredOn,
      revenue: sql<number>`coalesce(-sum(${amount}) filter (where ${ledgerLines.account} = 'revenue'), 0)`.mapWith(Number),
      expenses: sql<number>`coalesce(sum(${amount}) filter (where ${ledgerLines.account} <> 'revenue'), 0)`.mapWith(Number),
    })
    .from(ledgerLines)
    .innerJoin(t, eq(t.id, ledgerLines.transactionId))
    .where(
      and(
        ne(t.kind, "course_close"),
        inArray(ledgerLines.account, ["revenue", "instructor_fees", "course_expenses", "general_expenses"]),
        gte(t.occurredOn, months[0]),
        lt(t.occurredOn, until),
      ),
    )
    .groupBy(t.occurredOn)
  const byMonth = new Map<string, { month: string; revenue: number; expenses: number }>()
  for (const { day, revenue, expenses } of days) {
    const month = monthOf(day, months)
    if (!month) continue
    const row = byMonth.get(month) ?? { month, revenue: 0, expenses: 0 }
    row.revenue += revenue
    row.expenses += expenses
    byMonth.set(month, row)
  }
  return [...byMonth.values()]
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
  const held = and(tookPlace(now), gte(courses.startsAt, windowStart))

  const [row] = await exec
    .select({
      workshops: count(),
      upcoming: n(upcoming),
      held: n(held),
      // Every day's places (the participants figure counts every day's registrations).
      heldSeats: total(allDaysSeats, held),
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
      days: courses.days,
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

/** Every upcoming workshop open for registration (not awaiting signature), for the places on the card. */
function openWorkshops(exec: Exec, now: Date) {
  return exec
    .select({
      id: courses.id,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
      days: courses.days,
      minCapacity: courses.minCapacity,
      maxCapacity: courses.maxCapacity,
    })
    .from(courses)
    .where(and(inArray(courses.status, ["published", "confirmed"]), gte(courses.endsAt, now)))
}

/** The last workshops that took place, most recent first. */
function heldWorkshops(exec: Exec, now: Date) {
  return exec
    .select({
      id: courses.id,
      title: courses.title,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
      days: courses.days,
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
 * The dashboard, its months and year in `calendar` (the viewer's language's:
 * Persian counts Solar Hijri months, and the year from Nowruz). `now` and
 * `exec` are for tests (a fixed clock, a transaction that is rolled back
 * afterwards).
 */
export async function getDashboard(now: Date = new Date(), exec: Exec = db, calendar: CalendarSystem = "gregory") {
  await requireAdmin()
  const today = zonedParts(now).date
  const months = lastMonths(today, MONTHS, calendar)
  const windowStart = new Date(zonedToIso(months[0], "00:00")!)

  const [monthRows, wallet, counts, upcomingRows, openRows, heldRows, byWorkshop, byInstructor, people] = await gather(exec, [
    () => monthly(exec, months, addMonths(today, 1, calendar)),
    () => walletBalance(exec),
    () => summary(exec, now, windowStart),
    () => upcomingWorkshops(exec, now),
    () => openWorkshops(exec, now),
    () => heldWorkshops(exec, now),
    () => profitByWorkshop(exec, windowStart),
    () => profitByInstructor(exec, windowStart),
    () => partners(exec),
  ])
  // Places taken per day, live (registrations and held places), as the site and the workshops list count them.
  const ids = [...new Set([...upcomingRows, ...openRows].map((w) => w.id))]
  const takenOf = await seatsTakenOf(ids, exec)
  const registeredByDay = await registeredOf(upcomingRows.map((w) => w.id), exec)
  const open = openRows.map((w) => placesOf(w, takenOf.get(w.id)))

  const figures = fillMonths(months, monthRows)
  const [lastMonth, thisMonth] = figures.slice(-2)
  const year = calendarFields(today, calendar).year
  const yearStart = periodStart(today, "year", calendar)
  const upcoming = upcomingRows.map((w) => {
    const places = placesOf(w, takenOf.get(w.id), registeredByDay.get(w.id))
    const taken = sumOf(places, (p) => p.taken)
    return {
      ...w,
      /** Places taken on all the days: registrations and held places. */
      taken,
      /** Each day (or session) with its own places; one entry for a one-day workshop. */
      places,
      running: w.startsAt <= now,
      // Registrations against the minimum, as the go decision counts them (held places are no registration);
      // several days: each day must reach its own.
      alert: workshopAlert({ ...w, days: places.map((p) => ({ registered: p.registered, minCapacity: p.min })) }, now),
      payment: paymentNote(w),
    }
  })

  return {
    today,
    /** The calendar's year of today (1405 in Persian). */
    year,
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
      netThisYear: figures.filter((m) => m.month >= yearStart).reduce((s, m) => s + m.net, 0),
      upcoming: counts.upcoming,
      /** Places on every day of the open upcoming workshops, and how many are taken (live, held places included). */
      upcomingSeats: sumOf(open.flat(), (p) => p.max),
      upcomingTaken: sumOf(open.flat(), (p) => p.taken),
      held: counts.held,
      heldSeats: counts.heldSeats,
      heldTaken: counts.heldTaken,
      fillRate: fillRate(counts.heldTaken, counts.heldSeats),
    },
    attention: { decisionsDue: counts.decisionsDue, awaitingSignature: counts.awaitingSignature, toClose: counts.toClose },
    months: figures,
    partners: people,
    upcoming,
    /**
     * Recent and upcoming workshops, oldest first (registration is not open
     * while awaiting signature). An upcoming one on several days has a bar
     * per day (`place`; `id` is then "<workshop id>:<day>"); a held one, all
     * its days' places against its participants.
     */
    seats: [
      ...[...heldRows].reverse().map(({ endsAt, days, ...w }): SeatBar => {
        const places = placesOf({ ...w, endsAt, days }, undefined)
        return {
          ...w,
          workshopId: w.id,
          minCapacity: sumOf(places, (p) => p.min),
          maxCapacity: sumOf(places, (p) => p.max),
          upcoming: false,
          place: null,
        }
      }),
      ...upcoming
        .filter((w) => w.status !== "awaiting_signature")
        .flatMap(({ id, title, startsAt, minCapacity, maxCapacity, taken, places }): SeatBar[] =>
          places.length > 1
            ? places.map((p) => ({
                id: `${id}:${p.n - 1}`, workshopId: id, title, startsAt: p.startsAt,
                minCapacity: p.min, maxCapacity: p.max, registered: p.taken, upcoming: true, place: p,
              }))
            : [{ id, workshopId: id, title, startsAt, minCapacity, maxCapacity, registered: taken, upcoming: true, place: null }],
        ),
    ],
    profit: { workshops: byWorkshop, instructors: byInstructor },
  }
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>
export type UpcomingWorkshop = Dashboard["upcoming"][number]
export type SeatRow = Dashboard["seats"][number]
export type PartnerRow = Dashboard["partners"][number]
