import "server-only"
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { db } from "@/db"
import { admins, courses, instructors, ledgerLines, ledgerTransactions, registrations, type LocalizedText } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { partnerCapitals, type TransactionKind } from "./ledger"
import type { PeriodGroup } from "./schema"

/**
 * Accounting reports. Profit and loss figures leave out the closing entries
 * (which only move a closed workshop's result to the partners' capital), so a
 * workshop counts the same before and after it is closed.
 */

const t = ledgerTransactions
const sum = (accountName: string, credit = false) =>
  sql<number>`coalesce(${sql.raw(credit ? "-" : "")}sum(${ledgerLines.amount}) filter (where ${ledgerLines.account} = ${accountName}), 0)`.mapWith(Number)

export type PnlFigures = { revenue: number; instructorFees: number; courseExpenses: number; generalExpenses: number; net: number }

const withNet = (f: Omit<PnlFigures, "net">): PnlFigures => ({
  ...f,
  net: f.revenue - f.instructorFees - f.courseExpenses - f.generalExpenses,
})

function addTotals<T extends PnlFigures>(rows: T[]): PnlFigures {
  return withNet(
    rows.reduce(
      (a, r) => ({
        revenue: a.revenue + r.revenue,
        instructorFees: a.instructorFees + r.instructorFees,
        courseExpenses: a.courseExpenses + r.courseExpenses,
        generalExpenses: a.generalExpenses + r.generalExpenses,
      }),
      { revenue: 0, instructorFees: 0, courseExpenses: 0, generalExpenses: 0 },
    ),
  )
}

// ─── Profit and loss by period ────────────────────────────────────────────────

const units: Record<PeriodGroup, ReturnType<typeof sql.raw>> = {
  month: sql.raw("'month'"),
  quarter: sql.raw("'quarter'"),
  year: sql.raw("'year'"),
}
const stepMonths: Record<PeriodGroup, number> = { month: 1, quarter: 3, year: 12 }

/** The first day of every period from `from` to `to` ("YYYY-MM-01"). */
export function periodStarts(from: string, to: string, group: PeriodGroup): string[] {
  const step = stepMonths[group]
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7)) - 1
  if (group === "quarter") m -= m % 3
  if (group === "year") m = 0
  const out: string[] = []
  for (let i = 0; i < 1200; i++) {
    const start = `${y}-${String(m + 1).padStart(2, "0")}-01`
    if (start > to) break
    out.push(start)
    m += step
    y += Math.floor(m / 12)
    m %= 12
  }
  return out
}

/** Income and expenses per month, quarter or year, by the date each entry happened. */
export async function profitAndLoss(range: { from: string; to: string; group: PeriodGroup }) {
  await requireAdmin()
  const period = sql<string>`to_char(date_trunc(${units[range.group]}, ${t.occurredOn}::timestamp), 'YYYY-MM-DD')`
  const rows = await db
    .select({
      period,
      revenue: sum("revenue", true),
      instructorFees: sum("instructor_fees"),
      courseExpenses: sum("course_expenses"),
      generalExpenses: sum("general_expenses"),
    })
    .from(ledgerLines)
    .innerJoin(t, eq(t.id, ledgerLines.transactionId))
    .where(
      and(
        ne(t.kind, "course_close"),
        inArray(ledgerLines.account, ["revenue", "instructor_fees", "course_expenses", "general_expenses"]),
        sql`${t.occurredOn} between ${range.from} and ${range.to}`,
      ),
    )
    .groupBy(period)
  const byPeriod = new Map(rows.map((r) => [r.period, r]))
  const periods = periodStarts(range.from, range.to, range.group).map((start) => {
    const r = byPeriod.get(start)
    return {
      period: start,
      ...withNet({
        revenue: r?.revenue ?? 0,
        instructorFees: r?.instructorFees ?? 0,
        courseExpenses: r?.courseExpenses ?? 0,
        generalExpenses: r?.generalExpenses ?? 0,
      }),
    }
  })
  return { periods, total: addTotals(periods) }
}

// ─── By workshop and by instructor ────────────────────────────────────────────

/** Workshops that started in the range, with their figures (all time, closing entries left out). */
export async function workshopResults(range: { from: string; to: string }) {
  await requireAdmin()
  const totals = db
    .select({
      courseId: t.courseId,
      revenue: sum("revenue", true).as("revenue"),
      instructorFees: sum("instructor_fees").as("instructor_fees"),
      courseExpenses: sum("course_expenses").as("course_expenses"),
    })
    .from(ledgerLines)
    .innerJoin(t, eq(t.id, ledgerLines.transactionId))
    .where(and(isNotNull(t.courseId), ne(t.kind, "course_close")))
    .groupBy(t.courseId)
    .as("totals")
  const confirmed = sql<number>`(select count(*) from ${registrations} r where r.course_id = ${courses}.${sql.identifier("id")} and r.status = 'confirmed')`.mapWith(Number)

  const rows = await db
    .select({
      id: courses.id,
      title: courses.title,
      status: courses.status,
      startsAt: courses.startsAt,
      finalParticipants: courses.finalParticipants,
      closedTotals: courses.closedTotals,
      confirmed,
      instructorId: instructors.id,
      instructor: instructors.displayName,
      revenue: totals.revenue,
      instructorFees: totals.instructorFees,
      courseExpenses: totals.courseExpenses,
    })
    .from(courses)
    .innerJoin(instructors, eq(instructors.id, courses.instructorId))
    .leftJoin(totals, eq(totals.courseId, courses.id))
    .where(sql`(${courses.startsAt} at time zone 'Europe/Istanbul')::date between ${range.from} and ${range.to}`)
    .orderBy(asc(courses.startsAt), asc(courses.id))

  const workshops = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    startsAt: r.startsAt,
    instructorId: r.instructorId,
    instructor: r.instructor,
    participants:
      r.status === "cancelled" ? 0 : (r.closedTotals?.participants ?? r.finalParticipants ?? Number(r.confirmed)),
    ...withNet({
      revenue: Number(r.revenue ?? 0),
      instructorFees: Number(r.instructorFees ?? 0),
      courseExpenses: Number(r.courseExpenses ?? 0),
      generalExpenses: 0,
    }),
  }))
  return { workshops, total: { ...addTotals(workshops), participants: workshops.reduce((s, w) => s + w.participants, 0) } }
}

export type WorkshopResult = Awaited<ReturnType<typeof workshopResults>>["workshops"][number]

/** The same figures per instructor (workshops that started in the range). */
export async function instructorResults(range: { from: string; to: string }) {
  const { workshops, total } = await workshopResults(range)
  const groups = new Map<string, { instructorId: string; instructor: LocalizedText; workshops: number; participants: number; figures: WorkshopResult[] }>()
  for (const w of workshops) {
    const g = groups.get(w.instructorId) ?? { instructorId: w.instructorId, instructor: w.instructor, workshops: 0, participants: 0, figures: [] }
    g.workshops += 1
    g.participants += w.participants
    g.figures.push(w)
    groups.set(w.instructorId, g)
  }
  const instructorsRows = [...groups.values()]
    .map(({ figures, ...g }) => ({ ...g, ...addTotals(figures) }))
    .sort((a, b) => b.net - a.net)
  return { instructors: instructorsRows, total: { ...total, workshops: workshops.length } }
}

// ─── Partner statement ────────────────────────────────────────────────────────

/** One partner's capital account over a range: opening balance, every movement, closing balance. */
export async function partnerStatement(partnerId: string, range: { from: string; to: string }) {
  await requireAdmin()
  const [person] = await db
    .select({ id: admins.id, name: admins.name, email: admins.email, shareBp: admins.shareBp, active: admins.active })
    .from(admins)
    .where(eq(admins.id, partnerId))
  if (!person) return null

  const original = alias(ledgerTransactions, "original")
  const [opening, rows] = await Promise.all([
    partnerCapitals(db, range.from).then((m) => m.get(partnerId)?.capital ?? 0),
    db
      .select({
        id: t.id,
        occurredOn: t.occurredOn,
        kind: t.kind,
        originalKind: original.kind,
        description: t.description,
        courseTitle: courses.title,
        amount: ledgerLines.amount,
      })
      .from(ledgerLines)
      .innerJoin(t, eq(t.id, ledgerLines.transactionId))
      .leftJoin(original, eq(original.id, t.reversalOf))
      .leftJoin(courses, eq(courses.id, t.courseId))
      .where(
        and(
          eq(ledgerLines.account, "partner_capital"),
          eq(ledgerLines.partnerId, partnerId),
          sql`${t.occurredOn} between ${range.from} and ${range.to}`,
        ),
      )
      .orderBy(asc(t.occurredOn), asc(t.createdAt), asc(t.id)),
  ])

  let balance = opening
  const movements = rows.map((r) => {
    const amount = 0 - r.amount // credit-positive: what it added to the partner's capital
    balance += amount
    return { ...r, kind: r.kind as TransactionKind, amount, balance }
  })
  return { partner: person, opening, movements, closing: balance }
}

// ─── The ledger, line by line ─────────────────────────────────────────────────

/**
 * Every line of the transactions in the range (for an accountant's export),
 * with the same filters as the ledger page: kind, a line on an account or of a
 * partner, a workshop.
 */
export async function ledgerExport(
  range: { from: string; to: string },
  filters: { kind?: TransactionKind; account?: string; partner?: string; workshop?: string } = {},
) {
  await requireAdmin()
  const original = alias(ledgerTransactions, "original")
  const partner = alias(admins, "partner")
  const hasLine = (cond: ReturnType<typeof sql>) =>
    sql`exists (select 1 from ${ledgerLines} o where o.transaction_id = ${t.id} and ${cond})`
  return db
    .select({
      id: t.id,
      occurredOn: t.occurredOn,
      kind: t.kind,
      originalKind: original.kind,
      description: t.description,
      courseTitle: courses.title,
      account: ledgerLines.account,
      partnerName: partner.name,
      amount: ledgerLines.amount,
    })
    .from(ledgerLines)
    .innerJoin(t, eq(t.id, ledgerLines.transactionId))
    .leftJoin(original, eq(original.id, t.reversalOf))
    .leftJoin(courses, eq(courses.id, t.courseId))
    .leftJoin(partner, eq(partner.id, ledgerLines.partnerId))
    .where(
      and(
        sql`${t.occurredOn} between ${range.from} and ${range.to}`,
        filters.kind ? eq(t.kind, filters.kind) : undefined,
        filters.workshop ? eq(t.courseId, filters.workshop) : undefined,
        filters.account ? hasLine(sql`o.account = ${filters.account}`) : undefined,
        filters.partner ? hasLine(sql`o.partner_id = ${filters.partner}`) : undefined,
      ),
    )
    .orderBy(asc(t.occurredOn), asc(t.createdAt), asc(t.id), sql`${ledgerLines.amount} desc`)
}
