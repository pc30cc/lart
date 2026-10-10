import "server-only"
import { and, asc, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { db } from "@/db"
import { admins, courses, expenseFiles, instructors, ledgerLines, ledgerTransactions, registrations, type LocalizedText } from "@/db/schema"
import { projectedFees, totalOf } from "@/features/money/closing"
import { accountBalances, openResult, partnerCapitals } from "@/features/money/ledger"

/**
 * The figures the exports are built from (Settings → Backup). No access check
 * here: the routes check the admin, and the daily job runs on the server.
 * Amounts are kuruş; dates "YYYY-MM-DD" (Istanbul days).
 */

const t = ledgerTransactions
const creator = alias(admins, "creator")
export type Range = { from: string; to: string }
const inRange = (range?: Range): SQL | undefined => (range ? sql`${t.occurredOn} between ${range.from} and ${range.to}` : undefined)

/** Every expense (workshop, general, furnishing), with where it came from and whether it was reversed since. */
export async function expenseRows(range?: Range, courseId?: string) {
  const reversal = alias(ledgerTransactions, "reversal")
  return db
    .select({
      id: t.id,
      occurredOn: t.occurredOn,
      description: t.description,
      furnishing: t.furnishing,
      courseId: t.courseId,
      courseTitle: courses.title,
      amount: sql<number>`(select coalesce(sum(l.amount), 0) from ${ledgerLines} l where l.transaction_id = ${t.id} and l.account in ('course_expenses', 'general_expenses'))`.mapWith(Number),
      fromAdvance: sql<boolean>`exists (select 1 from ${ledgerLines} l where l.transaction_id = ${t.id} and l.account = 'instructor_advance')`,
      files: sql<number>`(select count(*) from ${expenseFiles} f where f.transaction_id = ${t.id})`.mapWith(Number),
      recordedBy: creator.name,
      reversed: sql<boolean>`${reversal.id} is not null`,
    })
    .from(t)
    .leftJoin(courses, eq(courses.id, t.courseId))
    .leftJoin(creator, eq(creator.id, t.createdBy))
    .leftJoin(reversal, eq(reversal.reversalOf, t.id))
    .where(and(eq(t.kind, "expense"), inRange(range), courseId ? eq(t.courseId, courseId) : undefined))
    .orderBy(asc(t.occurredOn), asc(t.createdAt))
}
export type ExpenseRow = Awaited<ReturnType<typeof expenseRows>>[number]

/** Every line of every transaction (the journal), oldest first. */
export async function journalRows(range?: Range, courseId?: string) {
  const original = alias(ledgerTransactions, "original")
  const partner = alias(admins, "partner")
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
      recordedBy: creator.name,
    })
    .from(ledgerLines)
    .innerJoin(t, eq(t.id, ledgerLines.transactionId))
    .leftJoin(original, eq(original.id, t.reversalOf))
    .leftJoin(courses, eq(courses.id, t.courseId))
    .leftJoin(partner, eq(partner.id, ledgerLines.partnerId))
    .leftJoin(creator, eq(creator.id, t.createdBy))
    .where(and(inRange(range), courseId ? eq(t.courseId, courseId) : undefined))
    .orderBy(asc(t.occurredOn), asc(t.createdAt), asc(t.id), sql`${ledgerLines.amount} desc`)
}
export type JournalRow = Awaited<ReturnType<typeof journalRows>>[number]

const sum = (account: string, credit = false) =>
  sql<number>`coalesce(${sql.raw(credit ? "-" : "")}sum(${ledgerLines.amount}) filter (where ${ledgerLines.account} = ${account}), 0)`.mapWith(Number)

/**
 * Each workshop's result (the closing entry left out): income, materials,
 * instructor fee (booked at closing, or what a confirmed one will owe), the
 * net, and each partner's share once closed. `ids`: only these workshops.
 */
export async function workshopRows(ids?: string[]) {
  const totals = await db
    .select({
      courseId: t.courseId,
      revenue: sum("revenue", true),
      instructorFees: sum("instructor_fees"),
      courseExpenses: sum("course_expenses"),
    })
    .from(ledgerLines)
    .innerJoin(t, eq(t.id, ledgerLines.transactionId))
    .where(and(isNotNull(t.courseId), ne(t.kind, "course_close"), ids ? inArray(t.courseId, ids) : undefined))
    .groupBy(t.courseId)
  const byId = new Map(totals.map((r) => [r.courseId, r]))
  const [rows, fees] = await Promise.all([
    db
      .select({
        id: courses.id,
        title: courses.title,
        status: courses.status,
        startsAt: courses.startsAt,
        closedAt: courses.closedAt,
        instructor: instructors.displayName,
        participants: sql<number>`coalesce(${courses.finalParticipants}, (select count(*) from ${registrations} r where r.course_id = ${courses.id} and r.status in ('pending', 'confirmed')))`.mapWith(Number),
        price: courses.price,
      })
      .from(courses)
      .innerJoin(instructors, eq(instructors.id, courses.instructorId))
      .where(ids ? inArray(courses.id, ids) : undefined)
      .orderBy(asc(courses.startsAt)),
    projectedFees(db),
  ])
  return rows.map((c) => {
    const tot = byId.get(c.id)
    const projected = c.closedAt ? 0 : (fees.get(c.id) ?? 0)
    const revenue = tot?.revenue ?? 0
    const courseExpenses = tot?.courseExpenses ?? 0
    const instructorFees = (tot?.instructorFees ?? 0) + projected
    return { ...c, revenue, courseExpenses, instructorFees, projected: projected > 0, net: revenue - courseExpenses - instructorFees }
  })
}
export type WorkshopRow = Awaited<ReturnType<typeof workshopRows>>[number]

/** A workshop's registrations: who, how much, paid when and how, cancelled and refunded. */
export async function registrationRows(courseId: string) {
  return db
    .select({
      participant: registrations.participantName,
      status: registrations.status,
      amount: registrations.amount,
      method: registrations.paymentMethod,
      paidAt: registrations.paidAt,
      cancelledAt: registrations.cancelledAt,
      refundAmount: registrations.refundAmount,
      refundedAt: registrations.refundedAt,
      createdAt: registrations.createdAt,
    })
    .from(registrations)
    .where(eq(registrations.courseId, courseId))
    .orderBy(asc(registrations.createdAt))
}

/** Each partner's capital account and share of the result not shared out yet. */
export async function partnerRows() {
  const [people, capitals, open] = await Promise.all([
    db.select({ id: admins.id, name: admins.name, shareBp: admins.shareBp, active: admins.active }).from(admins).orderBy(desc(admins.shareBp), asc(admins.createdAt)),
    partnerCapitals(db),
    notSharedOut(),
  ])
  const sharing = people.filter((p) => p.active && p.shareBp > 0)
  return people
    .filter((p) => p.active || capitals.has(p.id))
    .map((p) => {
      const c = capitals.get(p.id)
      const openShare = sharing.some((s) => s.id === p.id) ? Math.round((open * p.shareBp) / 10000) : 0
      return {
        name: p.name,
        shareBp: p.shareBp,
        contributions: c?.contributions ?? 0,
        withdrawals: c?.withdrawals ?? 0,
        profitShares: c?.profitShares ?? 0,
        capital: c?.capital ?? 0,
        openShare,
        equity: (c?.capital ?? 0) + openShare,
      }
    })
}

async function notSharedOut() {
  const [ledger, fees] = await Promise.all([openResult(db), projectedFees(db)])
  return ledger - totalOf(fees)
}

/** The wallet and its split, as on the wallet page. */
export async function walletSummary() {
  const [balances, open, capitals] = await Promise.all([accountBalances(db), notSharedOut(), partnerCapitals(db)])
  const all = [...capitals.values()]
  const putIn = all.reduce((s, c) => s + c.contributions - c.withdrawals, 0)
  const overhead = balances.general_expenses
  const workshops = all.reduce((s, c) => s + c.profitShares, 0) + open + overhead
  const remaining = putIn - overhead
  return {
    wallet: balances.wallet,
    advances: balances.instructor_advance,
    owedToInstructors: balances.instructor_payable,
    putIn,
    overhead,
    remaining,
    workshops,
    other: balances.wallet - remaining - workshops,
  }
}

/** Income and costs of a period by the day each entry happened (an instructor fee on its closing day). */
export async function periodFigures(range: Range) {
  const [row] = await db
    .select({
      revenue: sum("revenue", true),
      instructorFees: sum("instructor_fees"),
      courseExpenses: sum("course_expenses"),
      generalExpenses: sum("general_expenses"),
      contributions: sql<number>`coalesce(sum(${ledgerLines.amount}) filter (where ${ledgerLines.account} = 'wallet' and ${t.kind} = 'capital_contribution'), 0)`.mapWith(Number),
      walletIn: sql<number>`coalesce(sum(${ledgerLines.amount}) filter (where ${ledgerLines.account} = 'wallet' and ${ledgerLines.amount} > 0), 0)`.mapWith(Number),
      walletOut: sql<number>`coalesce(-sum(${ledgerLines.amount}) filter (where ${ledgerLines.account} = 'wallet' and ${ledgerLines.amount} < 0), 0)`.mapWith(Number),
    })
    .from(ledgerLines)
    .innerJoin(t, eq(t.id, ledgerLines.transactionId))
    .where(and(ne(t.kind, "course_close"), inRange(range)))
  const furnishing = await db
    .select({ total: sql<number>`coalesce(sum(${ledgerLines.amount}), 0)`.mapWith(Number) })
    .from(ledgerLines)
    .innerJoin(t, eq(t.id, ledgerLines.transactionId))
    .where(and(eq(t.furnishing, true), eq(ledgerLines.account, "general_expenses"), inRange(range)))
  return {
    ...row,
    furnishing: furnishing[0]?.total ?? 0,
    net: row.revenue - row.instructorFees - row.courseExpenses - row.generalExpenses,
  }
}

/** Workshops closed within the range. */
export async function closedIn(range: Range) {
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(isNotNull(courses.closedAt), sql`(${courses.closedAt} at time zone 'Europe/Istanbul')::date between ${range.from} and ${range.to}`))
  return rows.map((r) => r.id)
}

/** One workshop's title, dates and status, or null. */
export async function workshopHead(courseId: string) {
  const [row] = await db
    .select({ id: courses.id, title: courses.title, slug: courses.slug, status: courses.status, startsAt: courses.startsAt, endsAt: courses.endsAt, closedAt: courses.closedAt })
    .from(courses)
    .where(eq(courses.id, courseId))
  return row ?? null
}

/** Every file kept with an expense, with where it belongs (for the invoices ZIP). */
export async function invoiceFiles() {
  return db
    .select({
      path: expenseFiles.path,
      role: expenseFiles.role,
      occurredOn: t.occurredOn,
      description: t.description,
      furnishing: t.furnishing,
      courseId: t.courseId,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      courseStart: courses.startsAt,
    })
    .from(expenseFiles)
    .innerJoin(t, eq(t.id, expenseFiles.transactionId))
    .leftJoin(courses, eq(courses.id, t.courseId))
    .orderBy(asc(t.occurredOn), asc(expenseFiles.createdAt))
}

export type { LocalizedText }
