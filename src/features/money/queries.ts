import "server-only"
import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { likePattern, type TableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { admins, courses, instructors, ledgerLines, ledgerTransactions, type LocalizedText } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { splitByShares } from "@/lib/money"
import { activePartners, prepareClosing, projectedFees, totalOf, workshopsToClose } from "./closing"
import { accountBalances, booksClosed, openResult, partnerCapitals, registrationKinds, type Account, type TransactionKind } from "./ledger"
import type { transactionTable } from "./schema"

const t = ledgerTransactions
const original = alias(ledgerTransactions, "original")
const creator = alias(admins, "creator")

/** A column qualified by hand, for use inside raw subqueries (see categories/queries.ts). */
const q = (table: typeof ledgerTransactions | typeof courses | typeof admins, column: { name: string }) =>
  sql`${table}.${sql.identifier(column.name)}`

/** Total debits of a transaction (its size), and what it did to the wallet. */
const size = sql<number>`(select coalesce(sum(l.amount), 0) from ${ledgerLines} l where l.transaction_id = ${q(t, t.id)} and l.amount > 0)`.mapWith(Number)
const walletChange = sql<number>`(select coalesce(sum(l.amount), 0) from ${ledgerLines} l where l.transaction_id = ${q(t, t.id)} and l.account = 'wallet')`.mapWith(Number)
const reversedBy = sql<string | null>`(select r.id from ${ledgerTransactions} r where r.reversal_of = ${q(t, t.id)})`

export type EntryLine = { account: Account; partnerId: string | null; partnerName: string | null; amount: number }

export type Entry = {
  id: string
  kind: TransactionKind
  /** For a reversal: the kind of the entry it cancels. */
  originalKind: TransactionKind | null
  reversalOf: string | null
  reversedBy: string | null
  occurredOn: string
  description: string
  courseId: string | null
  courseTitle: LocalizedText | null
  courseStatus: (typeof courses.status.enumValues)[number] | null
  /** When the workshop's books were closed (also set for a cancelled workshop that was closed). */
  courseClosedAt: Date | null
  createdBy: string | null
  createdAt: Date
  amount: number
  walletChange: number
  lines: EntryLine[]
}

/** Transactions with their lines, newest first unless `orderBy` says otherwise. */
async function loadEntries(options: { where?: SQL; orderBy?: SQL[]; limit?: number; offset?: number }): Promise<Entry[]> {
  const query = db
    .select({
      id: t.id,
      kind: t.kind,
      originalKind: original.kind,
      reversalOf: t.reversalOf,
      reversedBy,
      occurredOn: t.occurredOn,
      description: t.description,
      courseId: t.courseId,
      courseTitle: courses.title,
      courseStatus: courses.status,
      courseClosedAt: courses.closedAt,
      createdBy: creator.name,
      createdAt: t.createdAt,
      amount: size,
      walletChange,
    })
    .from(t)
    .leftJoin(original, eq(original.id, t.reversalOf))
    .leftJoin(courses, eq(courses.id, t.courseId))
    .leftJoin(creator, eq(creator.id, t.createdBy))
    .where(options.where)
    .orderBy(...(options.orderBy ?? [desc(t.occurredOn), desc(t.createdAt)]), desc(t.id))
    .$dynamic()
  if (options.limit) query.limit(options.limit)
  if (options.offset) query.offset(options.offset)
  const rows = await query
  if (!rows.length) return []

  const lines = await db
    .select({
      transactionId: ledgerLines.transactionId,
      account: ledgerLines.account,
      partnerId: ledgerLines.partnerId,
      partnerName: admins.name,
      amount: ledgerLines.amount,
    })
    .from(ledgerLines)
    .leftJoin(admins, eq(admins.id, ledgerLines.partnerId))
    .where(inArray(ledgerLines.transactionId, rows.map((r) => r.id)))
    .orderBy(desc(ledgerLines.amount))
  const byTx = Map.groupBy(lines, (l) => l.transactionId)
  return rows.map((r) => ({
    ...r,
    lines: (byTx.get(r.id) ?? []).map((l) => ({ account: l.account, partnerId: l.partnerId, partnerName: l.partnerName, amount: l.amount })),
  }))
}

/**
 * Can the panel offer "Reverse" for this entry? (The server checks again.)
 * Not a reversal or a closing entry, not a registration's payment or refund
 * (undone by cancelling the registration), not reversed yet, and nothing that
 * would change a closed workshop's figures (paying its instructor can still be corrected).
 */
export function isReversible(entry: Pick<Entry, "kind" | "reversedBy" | "courseStatus" | "courseClosedAt">): boolean {
  if (entry.reversedBy || ["reversal", "course_settlement", "course_close", ...registrationKinds].includes(entry.kind)) return false
  const closed = entry.courseStatus !== null && booksClosed({ status: entry.courseStatus, closedAt: entry.courseClosedAt })
  return !closed || entry.kind === "instructor_payment"
}

/**
 * Result not shared out to the partners yet: the ledger's open result minus
 * the fees confirmed workshops will owe their instructors (booked at closing).
 */
async function notSharedOut() {
  const [ledger, fees] = await Promise.all([openResult(db), projectedFees(db)])
  return ledger - totalOf(fees)
}

// ─── Wallet overview ──────────────────────────────────────────────────────────

/** Money held by or owed to instructors, per workshop (advances out, fees not yet paid). */
async function withInstructors() {
  const advance = sql<number>`coalesce(sum(${ledgerLines.amount}) filter (where ${ledgerLines.account} = 'instructor_advance'), 0)`.mapWith(Number)
  const owed = sql<number>`coalesce(-sum(${ledgerLines.amount}) filter (where ${ledgerLines.account} = 'instructor_payable'), 0)`.mapWith(Number)
  return db
    .select({ courseId: courses.id, title: courses.title, status: courses.status, instructor: instructors.displayName, advance, owed })
    .from(ledgerLines)
    .innerJoin(t, eq(t.id, ledgerLines.transactionId))
    .innerJoin(courses, eq(courses.id, t.courseId))
    .innerJoin(instructors, eq(instructors.id, courses.instructorId))
    .where(inArray(ledgerLines.account, ["instructor_advance", "instructor_payable"]))
    .groupBy(courses.id, instructors.id)
    .having(sql`${advance} <> 0 or ${owed} <> 0`)
    .orderBy(asc(courses.startsAt))
}

export async function getWalletOverview() {
  await requireAdmin()
  const [balances, open, recent, toClose, instructorsOpen, partners] = await Promise.all([
    accountBalances(db),
    notSharedOut(),
    loadEntries({ limit: 8 }),
    workshopsToClose(db),
    withInstructors(),
    activePartners(db),
  ])
  return { balances, openResult: open, recent, toClose, withInstructors: instructorsOpen, partners }
}

/** Active partners for the forms (who paid / who puts money in). */
export async function listActivePartners() {
  await requireAdmin()
  return activePartners(db)
}

// ─── Partners ─────────────────────────────────────────────────────────────────

/**
 * Every partner's capital account and share, plus their part of the result
 * not yet shared out (workshops not closed yet, after the fees confirmed ones
 * owe their instructors, and general expenses) by today's shares: capital +
 * that part = what they would get if the business settled today.
 */
export async function listPartnerAccounts() {
  await requireAdmin()
  const [people, capitals, open] = await Promise.all([
    db
      .select({ id: admins.id, name: admins.name, email: admins.email, active: admins.active, shareBp: admins.shareBp })
      .from(admins)
      .orderBy(desc(admins.active), desc(admins.shareBp), asc(admins.createdAt)),
    partnerCapitals(db),
    notSharedOut(),
  ])
  const partners = people.filter((p) => p.active || capitals.has(p.id))
  const sharing = partners.filter((p) => p.active && p.shareBp > 0)
  const sharesOk = sharing.reduce((s, p) => s + p.shareBp, 0) === 10000
  const openParts = sharesOk ? splitByShares(open, sharing.map((p) => p.shareBp)) : []
  const openOf = new Map(sharing.map((p, i) => [p.id, openParts[i] ?? 0]))

  const rows = partners.map((p) => {
    const c = capitals.get(p.id)
    const capital = c?.capital ?? 0
    const openShare = sharesOk ? (openOf.get(p.id) ?? 0) : 0
    return {
      ...p,
      contributions: c?.contributions ?? 0,
      withdrawals: c?.withdrawals ?? 0,
      paidForBusiness: c?.paidForBusiness ?? 0,
      profitShares: c?.profitShares ?? 0,
      capital,
      openShare,
      equity: capital + openShare,
    }
  })
  return { rows, openResult: open, sharesOk, activeCount: people.filter((p) => p.active).length }
}

export type PartnerAccount = Awaited<ReturnType<typeof listPartnerAccounts>>["rows"][number]

// ─── Ledger ───────────────────────────────────────────────────────────────────

type Sort = (typeof transactionTable.sort)[number]
type Filter = keyof typeof transactionTable.filters | "partner" | "workshop"

/** The ledger: search, filters (kind, account, partner, workshop, date range), sort, one page. */
export async function listTransactions(params: TableParams<Sort, Filter>, range: { from?: string; to?: string }) {
  await requireAdmin()
  const f = params.filters
  const lineWhere = (cond: SQL) =>
    exists(db.select({ one: sql`1` }).from(ledgerLines).where(and(sql`${ledgerLines.transactionId} = ${q(t, t.id)}`, cond)))
  const conditions: (SQL | undefined)[] = [
    f.kind ? eq(t.kind, f.kind as TransactionKind) : undefined,
    f.account ? lineWhere(eq(ledgerLines.account, f.account as Account)) : undefined,
    f.partner ? lineWhere(eq(ledgerLines.partnerId, f.partner)) : undefined,
    f.workshop ? eq(t.courseId, f.workshop) : undefined,
    range.from ? sql`${t.occurredOn} >= ${range.from}` : undefined,
    range.to ? sql`${t.occurredOn} <= ${range.to}` : undefined,
  ]
  if (params.q) {
    const pattern = likePattern(params.q)
    conditions.push(
      or(
        ilike(t.description, pattern),
        ...(["fa", "tr", "en"] as const).map((l) => ilike(sql`${courses.title}->>${l}`, pattern)),
      ),
    )
  }
  const where = and(...conditions)
  const direction = params.dir === "asc" ? asc : desc
  const orderBy = params.sort === "amount" ? [direction(size)] : [direction(t.occurredOn), direction(t.createdAt)]

  const [rows, [{ total }]] = await Promise.all([
    loadEntries({ where, orderBy, limit: params.pageSize, offset: params.offset }),
    db.select({ total: count() }).from(t).leftJoin(courses, eq(courses.id, t.courseId)).where(where),
  ])
  return { rows, total }
}

/** Choices for the ledger filters: people with capital entries or active, workshops with entries. */
export async function getLedgerFilterOptions() {
  await requireAdmin()
  const [people, workshops] = await Promise.all([
    db
      .select({ id: admins.id, name: admins.name })
      .from(admins)
      .where(
        or(
          eq(admins.active, true),
          exists(db.select({ one: sql`1` }).from(ledgerLines).where(sql`${ledgerLines.partnerId} = ${q(admins, admins.id)}`)),
        ),
      )
      .orderBy(asc(admins.name)),
    db
      .select({ id: courses.id, title: courses.title, startsAt: courses.startsAt })
      .from(courses)
      .where(exists(db.select({ one: sql`1` }).from(t).where(sql`${t.courseId} = ${q(courses, courses.id)}`)))
      .orderBy(desc(courses.startsAt))
      .limit(300),
  ])
  return { partners: people, workshops }
}

// ─── One workshop ─────────────────────────────────────────────────────────────

/**
 * A workshop's finances: live figures and the closing preview, and its
 * expenses, advance movements and instructor payments (reversals show as a
 * "reversed" mark on the entry they cancel). Null when the workshop does not exist.
 */
export async function getWorkshopFinances(courseId: string) {
  await requireAdmin()
  const preview = await prepareClosing(db, courseId)
  if (!preview) return null
  const entries = await loadEntries({
    where: and(eq(t.courseId, courseId), inArray(t.kind, ["expense", "instructor_advance", "instructor_payment"])),
    orderBy: [desc(t.occurredOn), desc(t.createdAt)],
  })
  return { ...preview, entries: entries.map(describeEntry) }
}

export type WorkshopFinances = NonNullable<Awaited<ReturnType<typeof getWorkshopFinances>>>

/**
 * What a workshop entry means, from its lines: the amount, and where the money
 * came from or went (the wallet, a partner personally, or the instructor's advance).
 */
export function describeEntry(entry: Entry) {
  const main: Account =
    entry.kind === "expense" ? "course_expenses" : entry.kind === "instructor_payment" ? "instructor_payable" : "instructor_advance"
  const mainLine = entry.lines.find((l) => l.account === main)
  const other = entry.lines.find((l) => l.account !== main)
  const amount = Math.abs(mainLine?.amount ?? entry.amount)
  return {
    ...entry,
    amount,
    /** For advance movements: paid to the instructor, or returned by them. */
    direction: (mainLine?.amount ?? 0) >= 0 ? ("paid" as const) : ("returned" as const),
    source:
      other?.account === "partner_capital"
        ? { type: "partner" as const, name: other.partnerName ?? "" }
        : other?.account === "instructor_advance"
          ? { type: "advance" as const, name: "" }
          : { type: "wallet" as const, name: "" },
  }
}

export type WorkshopEntry = ReturnType<typeof describeEntry>
