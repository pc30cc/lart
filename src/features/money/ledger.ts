import "server-only"
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { db, type Tx } from "@/db"
import {
  account,
  admins,
  courses,
  ledgerLines,
  ledgerTransactions,
  registrations,
  transactionKind,
} from "@/db/schema"
import { PG, pgError, UserError } from "@/lib/errors"
import { zonedParts } from "@/lib/format"
import { isIsoDate } from "./schema"

/**
 * The double-entry ledger. A line amount > 0 is a debit, < 0 a credit (kuruş).
 * The lines of a transaction sum to zero; the database checks it at commit and
 * refuses any UPDATE or DELETE. A mistake is corrected with a reversal.
 * Accounts kept per workshop (revenue, instructor_*, course_expenses) are
 * tracked through the transaction's `course_id`.
 *
 * Standard postings (the helpers below build them):
 *
 * | What happened                               | kind                 | Debit (+)                        | Credit (−)                                |
 * | ------------------------------------------- | -------------------- | -------------------------------- | ----------------------------------------- |
 * | Partner puts money in                       | capital_contribution | wallet                           | partner_capital (p)                       |
 * | Partner takes money out                     | capital_withdrawal   | partner_capital (p)              | wallet                                    |
 * | Expense paid from the wallet                | expense              | course_ or general_expenses      | wallet                                    |
 * | Expense set off against the advance (6.4)   | expense              | course_expenses                  | instructor_advance                        |
 * | Advance paid to the instructor              | instructor_advance   | instructor_advance               | wallet                                    |
 * | Advance returned by the instructor          | instructor_advance   | wallet                           | instructor_advance                        |
 * | Registration paid (phase 2)                 | registration_payment | wallet                           | revenue                                   |
 * | Registration refunded (phase 2)             | registration_refund  | revenue                          | wallet                                    |
 * | Closing (a): settlement                     | course_settlement    | instructor_fees (fee)            | instructor_advance (advance used),        |
 * |                                             |                      |                                  | instructor_payable (the rest)             |
 * | Closing (b): profit or loss to the partners | course_close         | revenue (its balance)            | instructor_fees, course_expenses (theirs) |
 * |                                             |                      | partner_capital (p) for a loss   | partner_capital (p) by share, for a profit|
 * | Instructor paid                             | instructor_payment   | instructor_payable               | wallet                                    |
 * | Correction                                  | reversal             | the mirror image of the original transaction                                 |
 *
 * Every cost is paid from the shared wallet: a partner never pays one
 * personally (their capital moves only with contributions, withdrawals and
 * profit shares).
 *
 * Closing entries (settlement, close) are dated on the day of closing and are
 * final: they are never reversed, and once a workshop is closed (`closed_at`
 * set, also for a cancelled one) nothing more is posted to its revenue, fees,
 * expenses or advance. Only paying out the instructor's payable stays open.
 */

export type Account = (typeof account.enumValues)[number]
export type TransactionKind = (typeof transactionKind.enumValues)[number]
export type Line = { account: Account; amount: number; partnerId?: string | null }
export type Posting = {
  kind: TransactionKind
  /** Istanbul calendar date, "YYYY-MM-DD". */
  occurredOn: string
  /** What it was for, as typed by the admin (may be empty for automatic entries). */
  description: string
  courseId?: string | null
  registrationId?: string | null
  /** The admin who recorded it; null for automatic entries (e.g. a payment gateway). */
  createdBy: string | null
  lines: Line[]
}
type Exec = Tx | typeof db

/** A broken posting is a programming error, never the user's: shown as the generic message. */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LedgerError"
  }
}

const allowedAccounts: Record<Exclude<TransactionKind, "reversal">, readonly Account[]> = {
  capital_contribution: ["wallet", "partner_capital"],
  capital_withdrawal: ["wallet", "partner_capital"],
  expense: ["course_expenses", "general_expenses", "wallet", "instructor_advance"],
  registration_payment: ["wallet", "revenue"],
  registration_refund: ["wallet", "revenue"],
  instructor_advance: ["instructor_advance", "wallet"],
  instructor_payment: ["instructor_payable", "wallet"],
  course_settlement: ["instructor_fees", "instructor_advance", "instructor_payable"],
  course_close: ["revenue", "instructor_fees", "course_expenses", "partner_capital"],
}

/** Accounts kept per workshop: a line on them needs the transaction's workshop. */
const courseAccounts: readonly Account[] = [
  "revenue",
  "instructor_fees",
  "course_expenses",
  "instructor_advance",
  "instructor_payable",
]
/** Locked once the workshop is closed (the payable stays open until the instructor is paid). */
const lockedWhenClosed: readonly Account[] = ["revenue", "instructor_fees", "course_expenses", "instructor_advance"]
/** Kinds that cannot be reversed: closing entries are final, and a reversal is not undone by another. */
const irreversible: readonly TransactionKind[] = ["course_settlement", "course_close", "reversal"]
/**
 * A registration's payment or refund is never reversed in the ledger: the
 * registration's own state (paid, refund owed / paid back) would no longer
 * match. A payment is undone by cancelling the registration (the refund it is
 * owed then appears in Money → Refunds).
 */
export const registrationKinds: readonly TransactionKind[] = ["registration_payment", "registration_refund"]

/** Today's date in Istanbul, "YYYY-MM-DD". */
export const today = (now: Date = new Date()) => zonedParts(now).date

/** The structural rules of a posting, checked before anything is written. Throws LedgerError. */
export function checkPosting(p: Posting): void {
  const fail = (why: string): never => {
    throw new LedgerError(`Invalid ${p.kind} posting: ${why}`)
  }
  if (!(transactionKind.enumValues as readonly string[]).includes(p.kind)) fail("unknown kind")
  if (!isIsoDate(p.occurredOn)) fail("occurredOn must be YYYY-MM-DD")
  if (typeof p.description !== "string" || p.description.length > 500) fail("description")
  if (p.lines.length < 2) fail("needs at least two lines")
  let sum = 0
  for (const line of p.lines) {
    if (!(account.enumValues as readonly string[]).includes(line.account)) fail(`unknown account ${line.account}`)
    if (!Number.isSafeInteger(line.amount) || line.amount === 0) fail("amounts are non-zero whole kuruş")
    if ((line.account === "partner_capital") !== Boolean(line.partnerId)) fail("partner_capital lines need a partner, others none")
    if (p.kind !== "reversal" && !allowedAccounts[p.kind].includes(line.account)) fail(`${line.account} not allowed`)
    if (courseAccounts.includes(line.account) && !p.courseId) fail(`${line.account} needs a workshop`)
    if (line.account === "general_expenses" && p.courseId) fail("a workshop expense goes to course_expenses")
    sum += line.amount
  }
  if (sum !== 0) fail(`lines sum to ${sum}, not 0`)
}

/**
 * Lock the workshop row against other money postings and closing (they all
 * take the same lock, so balance checks cannot race). Returns its status and
 * when its books were closed.
 * Lock order: workshop before registration; registration payments and refunds
 * (the registration row, and the FK KEY SHARE of their insert) and
 * cancelWorkshop (UPDATE registrations) rely on it.
 */
export async function lockCourse(tx: Tx, courseId: string) {
  const [course] = await tx
    .select({ status: courses.status, closedAt: courses.closedAt })
    .from(courses)
    .where(eq(courses.id, courseId))
    .for("no key update")
  if (!course) throw new UserError("money.errors.workshopGone")
  return course
}

/** A closed workshop's books are locked; a cancelled one keeps its status but has `closedAt` once closed. */
export const booksClosed = (course: { status: string; closedAt: Date | null }) =>
  course.status === "closed" || course.closedAt !== null

/**
 * Post one balanced transaction. Must run inside `db.transaction`: the
 * database checks the balance at commit. Returns the transaction id.
 */
export async function postTransaction(tx: Tx, p: Posting & { reversalOf?: string }): Promise<string> {
  checkPosting(p)

  const partnerIds = [...new Set(p.lines.flatMap((l) => (l.partnerId ? [l.partnerId] : [])))]
  if (partnerIds.length) {
    const people = await tx
      .select({ id: admins.id, active: admins.active })
      .from(admins)
      .where(inArray(admins.id, partnerIds))
    if (people.length !== partnerIds.length) throw new UserError("money.errors.partnerGone")
    // A correction may touch someone who has left; new entries only active partners.
    if (p.kind !== "reversal" && people.some((a) => !a.active)) throw new UserError("money.errors.partnerInactive")
  }

  if (p.courseId) {
    const course = await lockCourse(tx, p.courseId)
    if (booksClosed(course) && p.lines.some((l) => lockedWhenClosed.includes(l.account))) {
      throw new UserError("money.errors.workshopClosed")
    }
  }

  const [row] = await tx
    .insert(ledgerTransactions)
    .values({
      kind: p.kind,
      occurredOn: p.occurredOn,
      description: p.description,
      courseId: p.courseId ?? null,
      registrationId: p.registrationId ?? null,
      reversalOf: p.reversalOf ?? null,
      createdBy: p.createdBy,
    })
    .returning({ id: ledgerTransactions.id })
  await tx.insert(ledgerLines).values(
    p.lines.map((l) => ({ transactionId: row.id, account: l.account, partnerId: l.partnerId ?? null, amount: l.amount })),
  )
  return row.id
}

type Common = { occurredOn: string; description: string; createdBy: string }

const positive = (amount: number) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError("amount must be a positive whole number of kuruş")
}

// ─── Standard postings ────────────────────────────────────────────────────────

/** A partner puts money into the shared wallet. */
export function postContribution(tx: Tx, input: Common & { partnerId: string; amount: number }) {
  positive(input.amount)
  return postTransaction(tx, {
    ...input,
    kind: "capital_contribution",
    lines: [
      { account: "wallet", amount: input.amount },
      { account: "partner_capital", partnerId: input.partnerId, amount: -input.amount },
    ],
  })
}

/**
 * The partners put the same amount each into the shared wallet, as one
 * transaction (one line per partner): with equal shares, capital goes in
 * equally. A reversal takes all of it back at once.
 */
export function postJointContribution(tx: Tx, input: Common & { partnerIds: string[]; amountEach: number }) {
  positive(input.amountEach)
  if (input.partnerIds.length === 0) throw new LedgerError("a contribution needs at least one partner")
  const { partnerIds, amountEach, ...common } = input
  return postTransaction(tx, {
    ...common,
    kind: "capital_contribution",
    lines: [
      { account: "wallet", amount: amountEach * partnerIds.length },
      ...partnerIds.map((partnerId): Line => ({ account: "partner_capital", partnerId, amount: -amountEach })),
    ],
  })
}

/** A partner takes money out of the shared wallet. */
export function postWithdrawal(tx: Tx, input: Common & { partnerId: string; amount: number }) {
  positive(input.amount)
  return postTransaction(tx, {
    ...input,
    kind: "capital_withdrawal",
    lines: [
      { account: "partner_capital", partnerId: input.partnerId, amount: input.amount },
      { account: "wallet", amount: -input.amount },
    ],
  })
}

/**
 * An expense: of a workshop (`courseId`) or of the business in general.
 * Paid from the wallet, or (workshop only) out of the instructor's advance,
 * i.e. the instructor spent part of the advance on approved costs.
 */
export async function postExpense(
  tx: Tx,
  input: Common & { courseId?: string | null; amount: number; source: "wallet" | "advance" },
) {
  positive(input.amount)
  const { source, courseId = null } = input
  if (source === "advance") {
    if (!courseId) throw new LedgerError("only a workshop expense can come out of the advance")
    await lockCourse(tx, courseId)
    const { advance } = await courseBalances(tx, courseId)
    if (input.amount > advance) throw new UserError("money.errors.moreThanAdvance", { field: "amount" })
  }
  return postTransaction(tx, {
    ...input,
    kind: "expense",
    courseId,
    lines: [
      { account: courseId ? "course_expenses" : "general_expenses", amount: input.amount },
      { account: source === "advance" ? "instructor_advance" : "wallet", amount: -input.amount },
    ],
  })
}

/** An advance paid to the workshop's instructor from the wallet, or (part of it) returned by them to it. */
export async function postAdvance(tx: Tx, input: Common & { courseId: string; amount: number; direction: "paid" | "returned" }) {
  positive(input.amount)
  const { status } = await lockCourse(tx, input.courseId)
  const sign = input.direction === "paid" ? 1 : -1
  if (input.direction === "paid" && (status === "cancelled" || status === "closed")) {
    throw new UserError("money.errors.advanceNotNow")
  }
  if (input.direction === "returned") {
    const { advance } = await courseBalances(tx, input.courseId)
    if (input.amount > advance) throw new UserError("money.errors.moreThanAdvance", { field: "amount" })
  }
  return postTransaction(tx, {
    ...input,
    kind: "instructor_advance",
    lines: [
      { account: "instructor_advance", amount: sign * input.amount },
      { account: "wallet", amount: -sign * input.amount },
    ],
  })
}

/** Pay the instructor (part of) what the workshop owes them after closing, from the wallet. */
export async function postInstructorPayment(tx: Tx, input: Common & { courseId: string; amount: number }) {
  positive(input.amount)
  await lockCourse(tx, input.courseId)
  const { payable } = await courseBalances(tx, input.courseId)
  if (input.amount > payable) throw new UserError("money.errors.moreThanOwed", { field: "amount" })
  return postTransaction(tx, {
    ...input,
    kind: "instructor_payment",
    lines: [
      { account: "instructor_payable", amount: input.amount },
      { account: "wallet", amount: -input.amount },
    ],
  })
}

/**
 * Phase 2: a registration was paid (the amount comes from the registration,
 * never from the browser). Refused when the registration is already paid.
 */
export async function postRegistrationPayment(
  tx: Tx,
  input: { registrationId: string; occurredOn: string; description?: string; createdBy?: string | null },
) {
  const reg = await lockRegistration(tx, input.registrationId)
  if (reg.amount <= 0) throw new UserError("money.errors.nothingToPay")
  const money = await registrationMoney(tx, input.registrationId)
  if (money.paid > 0) throw new UserError("money.errors.alreadyPaid")
  return postTransaction(tx, {
    kind: "registration_payment",
    occurredOn: input.occurredOn,
    description: input.description ?? "",
    courseId: reg.courseId,
    registrationId: input.registrationId,
    createdBy: input.createdBy ?? null,
    lines: [
      { account: "wallet", amount: reg.amount },
      { account: "revenue", amount: -reg.amount },
    ],
  })
}

/** Phase 2: (part of) a registration's payment paid back. Never more than was paid and not yet refunded. */
export async function postRegistrationRefund(
  tx: Tx,
  input: { registrationId: string; amount: number; occurredOn: string; description?: string; createdBy?: string | null },
) {
  positive(input.amount)
  const reg = await lockRegistration(tx, input.registrationId)
  const money = await registrationMoney(tx, input.registrationId)
  if (input.amount > money.paid - money.refunded) throw new UserError("money.errors.moreThanPaid", { field: "amount" })
  return postTransaction(tx, {
    kind: "registration_refund",
    occurredOn: input.occurredOn,
    description: input.description ?? "",
    courseId: reg.courseId,
    registrationId: input.registrationId,
    createdBy: input.createdBy ?? null,
    lines: [
      { account: "revenue", amount: input.amount },
      { account: "wallet", amount: -input.amount },
    ],
  })
}

/**
 * Lock a registration, its workshop first (see `lockCourse`). Its workshop is
 * read without a lock: a registration never moves to another workshop.
 */
async function lockRegistration(tx: Tx, id: string) {
  const [row] = await tx.select({ courseId: registrations.courseId }).from(registrations).where(eq(registrations.id, id))
  if (!row) throw new UserError("money.errors.registrationGone")
  await lockCourse(tx, row.courseId)
  const [reg] = await tx
    .select({ courseId: registrations.courseId, amount: registrations.amount })
    .from(registrations)
    .where(eq(registrations.id, id))
    .for("update")
  if (!reg) throw new UserError("money.errors.registrationGone")
  return reg
}

// ─── Reversal ─────────────────────────────────────────────────────────────────

/**
 * Cancel a transaction by posting its mirror image (kind "reversal",
 * `reversal_of` = the original). The correction is dated when it is made
 * (default: today in Istanbul), so earlier periods never change. Never twice,
 * never a reversal, never a closing entry, never a registration's payment or
 * refund (`registrationKinds`: cancel the registration instead), and nothing
 * that touches a closed workshop's figures. Runs in its own transaction unless
 * `tx` is given.
 */
export async function reverseTransaction(
  id: string,
  adminId: string,
  options: { tx?: Tx; occurredOn?: string } = {},
): Promise<{ id: string; original: { kind: TransactionKind; courseId: string | null; description: string } }> {
  const run = async (tx: Tx) => {
    const [original] = await tx
      .select({
        kind: ledgerTransactions.kind,
        courseId: ledgerTransactions.courseId,
        registrationId: ledgerTransactions.registrationId,
        description: ledgerTransactions.description,
      })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, id))
    if (!original) throw new UserError("money.errors.entryGone")
    if (original.kind === "reversal") throw new UserError("money.errors.cannotReverseReversal")
    if (irreversible.includes(original.kind)) throw new UserError("money.errors.closingIsFinal")
    if (registrationKinds.includes(original.kind)) throw new UserError("money.errors.registrationEntry")
    if (original.courseId) await lockCourse(tx, original.courseId)

    const [already] = await tx
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.reversalOf, id))
    if (already) throw new UserError("money.errors.alreadyReversed")

    const lines = await tx
      .select({ account: ledgerLines.account, partnerId: ledgerLines.partnerId, amount: ledgerLines.amount })
      .from(ledgerLines)
      .where(eq(ledgerLines.transactionId, id))
    const mirror = lines.map((l) => ({ ...l, amount: -l.amount }))

    // Undo later entries first: an advance cannot go below zero.
    if (original.courseId) {
      const advanceChange = mirror.filter((l) => l.account === "instructor_advance").reduce((s, l) => s + l.amount, 0)
      if (advanceChange < 0 && (await courseBalances(tx, original.courseId)).advance + advanceChange < 0) {
        throw new UserError("money.errors.reverseLaterFirst")
      }
    }

    const reversalId = await postTransaction(tx, {
      kind: "reversal",
      occurredOn: options.occurredOn ?? today(),
      description: original.description,
      courseId: original.courseId,
      registrationId: original.registrationId,
      createdBy: adminId,
      reversalOf: id,
      lines: mirror,
    })
    return { id: reversalId, original: { kind: original.kind, courseId: original.courseId, description: original.description } }
  }
  try {
    return options.tx ? await run(options.tx) : await db.transaction(run)
  } catch (err) {
    // Two admins reversing at the same moment: the unique reversal_of stops the second.
    if (pgError(err)?.code === PG.uniqueViolation) throw new UserError("money.errors.alreadyReversed")
    throw err
  }
}

// ─── Balances ─────────────────────────────────────────────────────────────────

const lineSum = sql<number>`coalesce(sum(${ledgerLines.amount}), 0)`.mapWith(Number)
/** Credit-positive view of a debit-positive sum (without a "-0"). */
const credit = (n: number) => 0 - n

/** Signed sums (debit-positive) per account and partner, over the lines matching `where`. */
async function sums(exec: Exec, where?: SQL) {
  return exec
    .select({ account: ledgerLines.account, partnerId: ledgerLines.partnerId, total: lineSum })
    .from(ledgerLines)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerLines.transactionId))
    .where(where)
    .groupBy(ledgerLines.account, ledgerLines.partnerId)
}

/** Cash in the shared wallet. */
export async function walletBalance(exec: Exec = db): Promise<number> {
  const [row] = await exec.select({ total: lineSum }).from(ledgerLines).where(eq(ledgerLines.account, "wallet"))
  return row.total
}

export type AccountBalances = Record<Account, number>

/**
 * Balance of every account in its natural sign: assets and expenses
 * debit-positive (wallet, instructor_advance, *_fees, *_expenses), liabilities,
 * equity and income credit-positive (instructor_payable, partner_capital, revenue).
 */
export async function accountBalances(exec: Exec = db): Promise<AccountBalances> {
  const out = Object.fromEntries(account.enumValues.map((a) => [a, 0])) as AccountBalances
  for (const row of await sums(exec)) out[row.account] += creditNatural.has(row.account) ? credit(row.total) : row.total
  return out
}
const creditNatural = new Set<Account>(["instructor_payable", "partner_capital", "revenue"])

export type CourseBalances = {
  /** Registration income, net of refunds. */
  revenue: number
  instructorFees: number
  courseExpenses: number
  /** Advance paid to the instructor and not yet returned, spent or settled. */
  advance: number
  /** Owed to the instructor after closing, not yet paid. */
  payable: number
}

/** A workshop's figures from the ledger, before the closing entry moves them to the partners. */
export async function courseBalances(exec: Exec, courseId: string): Promise<CourseBalances> {
  const rows = await sums(exec, and(eq(ledgerTransactions.courseId, courseId), ne(ledgerTransactions.kind, "course_close")))
  const get = (a: Account) => rows.find((r) => r.account === a)?.total ?? 0
  return {
    revenue: credit(get("revenue")),
    instructorFees: get("instructor_fees"),
    courseExpenses: get("course_expenses"),
    advance: get("instructor_advance"),
    payable: credit(get("instructor_payable")),
  }
}

/** Paid and refunded amounts of one registration (reversals included). */
export async function registrationMoney(exec: Exec, registrationId: string) {
  const original = alias(ledgerTransactions, "original")
  const effective = sql`coalesce(${original.kind}, ${ledgerTransactions.kind})`
  const [row] = await exec
    .select({
      paid: sql<number>`coalesce(sum(${ledgerLines.amount}) filter (where ${effective} = 'registration_payment'), 0)`.mapWith(Number),
      refunded: sql<number>`coalesce(-sum(${ledgerLines.amount}) filter (where ${effective} = 'registration_refund'), 0)`.mapWith(Number),
    })
    .from(ledgerLines)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerLines.transactionId))
    .leftJoin(original, eq(original.id, ledgerTransactions.reversalOf))
    .where(and(eq(ledgerTransactions.registrationId, registrationId), eq(ledgerLines.account, "wallet")))
  return row
}

export type PartnerCapital = {
  partnerId: string
  /** Money put in, minus reversed contributions. */
  contributions: number
  /** Money taken out. */
  withdrawals: number
  /** Profit (or, negative, loss) shares from closed workshops. */
  profitShares: number
  /** The partner's capital account: contributions − withdrawals + profit shares. */
  capital: number
}

/**
 * Each partner's capital account, broken down by what moved it. A reversal
 * counts under the kind of the transaction it cancels. `before`: only entries
 * dated before that day (an opening balance).
 */
export async function partnerCapitals(exec: Exec = db, before?: string): Promise<Map<string, PartnerCapital>> {
  const original = alias(ledgerTransactions, "original")
  const kind = sql<TransactionKind>`coalesce(${original.kind}, ${ledgerTransactions.kind})`
  const rows = await exec
    .select({ partnerId: ledgerLines.partnerId, kind, total: lineSum })
    .from(ledgerLines)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerLines.transactionId))
    .leftJoin(original, eq(original.id, ledgerTransactions.reversalOf))
    .where(
      and(
        eq(ledgerLines.account, "partner_capital"),
        before ? sql`${ledgerTransactions.occurredOn} < ${before}` : undefined,
      ),
    )
    .groupBy(ledgerLines.partnerId, kind)

  const out = new Map<string, PartnerCapital>()
  for (const row of rows) {
    if (!row.partnerId) continue
    const p =
      out.get(row.partnerId) ??
      { partnerId: row.partnerId, contributions: 0, withdrawals: 0, profitShares: 0, capital: 0 }
    const amount = credit(row.total)
    if (row.kind === "capital_contribution") p.contributions += amount
    else if (row.kind === "capital_withdrawal") p.withdrawals += row.total
    else if (row.kind === "course_close") p.profitShares += amount
    p.capital += amount
    out.set(row.partnerId, p)
  }
  return out
}

/**
 * Result in the ledger not yet shared out to the partners: revenue − fees −
 * expenses of workshops that are not closed yet, and all general expenses.
 * A workshop's instructor fee is booked only when it is closed: add
 * `projectedFees` (closing.ts) for what confirmed workshops will owe.
 */
export async function openResult(exec: Exec = db): Promise<number> {
  const [row] = await exec
    .select({ total: lineSum })
    .from(ledgerLines)
    .where(inArray(ledgerLines.account, ["revenue", "instructor_fees", "course_expenses", "general_expenses"]))
  return credit(row.total)
}
