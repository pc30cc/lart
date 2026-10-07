import "server-only"
import { and, asc, desc, eq, ne, sql } from "drizzle-orm"

import { db, type Tx } from "@/db"
import { admins, contracts, courses, registrations, type ClosedTotals } from "@/db/schema"
import { UserError } from "@/lib/errors"
import { splitByShares } from "@/lib/money"
import { courseBalances, postTransaction, today, type CourseBalances, type Line } from "./ledger"

/**
 * Closing a workshop. The figures are computed in one place (`closingPlan`),
 * shown as a preview on the finances page and posted by `closeCourse` in one
 * database transaction:
 *   (a) settlement: Dr instructor_fees (fee) / Cr instructor_advance (advance used)
 *       / Cr instructor_payable (the rest still owed to the instructor);
 *   (b) close: the workshop's revenue, fees and expenses go to the partners'
 *       capital by share (a profit is credited, a loss debited), so those
 *       workshop balances become zero.
 * Both are dated on the day of closing, so periods already reported never change.
 * Until then the ledger has no instructor fee for the workshop: `projectedFees`
 * gives what confirmed workshops will owe, for the figures that need it.
 */

export type FeeBasis = { type: "fixed" | "per_participant"; amount: number } | null
export type Partner = { adminId: string; name: string; shareBp: number }

/** Why a workshop cannot be closed (yet). Message keys: money.close.issues.<issue>. */
export type ClosingIssue =
  | "closed"
  | "notClosable"
  | "notEnded"
  | "noContract"
  | "refundsOwed"
  | "revenueMismatch"
  | "advanceTooBig"
  | "sharesNot100"

/** The instructor fee: nothing for a cancelled workshop, else fixed or per participant. */
export function instructorFee(cancelled: boolean, contract: FeeBasis, participants: number): number {
  if (cancelled || !contract) return 0
  return contract.type === "fixed" ? contract.amount : contract.amount * participants
}

export type ClosingFigures = {
  revenue: number
  instructorFee: number
  expenses: number
  netProfit: number
  participants: number
  /** Advance paid to the instructor and still open. */
  advance: number
  /** Still owed to the instructor after the advance is set off. */
  owedToInstructor: number
  /** Empty while the shares do not add up to 100 %. */
  partners: (Partner & { amount: number })[]
}

/** The exact figures and ledger lines of closing. Pure: no database. */
export function closingPlan(input: {
  cancelled: boolean
  contract: FeeBasis
  participants: number
  balances: CourseBalances
  partners: Partner[]
}): { figures: ClosingFigures; settlement: Line[]; close: Line[]; issues: ClosingIssue[] } {
  const { balances } = input
  const participants = input.cancelled ? 0 : input.participants
  const fee = instructorFee(input.cancelled, input.contract, participants)
  const fees = balances.instructorFees + fee
  const netProfit = balances.revenue - fees - balances.courseExpenses
  const issues: ClosingIssue[] = []

  // Contract 6.4 / 7.3: the advance is set off against the fee; anything above
  // it must be returned or recorded as an expense paid from the advance first.
  if (balances.advance < 0 || balances.advance > fee) issues.push("advanceTooBig")
  const shared = input.partners.filter((p) => p.shareBp > 0)
  const sharesOk = shared.length > 0 && shared.reduce((s, p) => s + p.shareBp, 0) === 10000
  if (!sharesOk) issues.push("sharesNot100")

  const amounts = sharesOk ? splitByShares(netProfit, shared.map((p) => p.shareBp)) : []
  const partners = sharesOk ? shared.map((p, i) => ({ ...p, amount: amounts[i] || 0 })) : [] // no "-0"
  const advanceUsed = Math.max(0, Math.min(balances.advance, fee))
  const nonZero = (lines: Line[]) => lines.filter((l) => l.amount !== 0)

  return {
    figures: {
      revenue: balances.revenue,
      instructorFee: fees,
      expenses: balances.courseExpenses,
      netProfit,
      participants,
      advance: balances.advance,
      owedToInstructor: fee - advanceUsed,
      partners,
    },
    settlement: nonZero([
      { account: "instructor_fees", amount: fee },
      { account: "instructor_advance", amount: -advanceUsed },
      { account: "instructor_payable", amount: -(fee - advanceUsed) },
    ]),
    close: nonZero([
      { account: "revenue", amount: balances.revenue },
      { account: "instructor_fees", amount: -fees },
      { account: "course_expenses", amount: -balances.courseExpenses },
      ...partners.map((p): Line => ({ account: "partner_capital", partnerId: p.adminId, amount: -p.amount })),
    ]),
    issues,
  }
}

type Exec = Tx | typeof db

/** The workshop's current (live) contract, or null. */
async function liveContract(exec: Exec, courseId: string) {
  const [row] = await exec
    .select({ feeType: contracts.feeType, feeAmount: contracts.feeAmount, advanceAmount: contracts.advanceAmount, status: contracts.status })
    .from(contracts)
    .where(and(eq(contracts.courseId, courseId), ne(contracts.status, "void")))
    .orderBy(desc(contracts.version))
    .limit(1)
  return row ?? null
}

/**
 * Active partners with their shares, in a stable order. `lock`: hold the shares
 * until commit; the rows are locked in id order, like `updateShares` does, so the
 * two never deadlock.
 */
export async function activePartners(exec: Exec, lock = false): Promise<Partner[]> {
  if (lock) await exec.select({ id: admins.id }).from(admins).where(eq(admins.active, true)).orderBy(asc(admins.id)).for("share")
  return exec
    .select({ adminId: admins.id, name: admins.name, shareBp: admins.shareBp })
    .from(admins)
    .where(eq(admins.active, true))
    .orderBy(desc(admins.shareBp), asc(admins.createdAt), asc(admins.id))
}

/**
 * Everything needed to show a workshop's finances and to close it: the live
 * figures (projected for a workshop still running), the closing plan and the
 * reasons it cannot be closed yet. Null when the workshop does not exist.
 */
export async function prepareClosing(exec: Exec, courseId: string, now: Date = new Date(), lock = false) {
  const [course] = await exec
    .select({
      status: courses.status,
      endsAt: courses.endsAt,
      finalParticipants: courses.finalParticipants,
      closedAt: courses.closedAt,
      closedTotals: courses.closedTotals,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
  if (!course) return null

  // One after another: inside a transaction the queries share one connection.
  const contract = await liveContract(exec, courseId)
  const [regs] = await exec
    .select({
      confirmed: sql<number>`count(*) filter (where ${registrations.status} = 'confirmed')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${registrations.status} = 'pending')`.mapWith(Number),
      // What the registrations say the workshop earned: paid amounts minus refunds.
      expectedRevenue: sql<number>`coalesce(sum(case when ${registrations.status} = 'confirmed' or ${registrations.paidAt} is not null then ${registrations.amount} else 0 end) - sum(coalesce(${registrations.refundAmount}, 0)), 0)`.mapWith(Number),
      // Refunds owed and not paid back yet (Money → Refunds): still in the books as revenue.
      refundsOwed: sql<number>`coalesce(sum(${registrations.refundAmount}) filter (where ${registrations.refundedAt} is null), 0)`.mapWith(Number),
    })
    .from(registrations)
    .where(eq(registrations.courseId, courseId))
  const balances = await courseBalances(exec, courseId)
  const partners = await activePartners(exec, lock)

  const cancelled = course.status === "cancelled"
  // Fixed at the go decision; before it, everyone registered (paid or not yet), as the go decision counts.
  const participants = course.finalParticipants ?? regs.confirmed + regs.pending
  const plan = closingPlan({
    cancelled,
    contract: contract ? { type: contract.feeType, amount: contract.feeAmount } : null,
    participants,
    balances,
    partners,
  })

  // The live view counts revenue as the registrations say (paid minus refunds);
  // closing uses the ledger, and is refused while the two differ.
  const projection = closingPlan({
    cancelled,
    contract: contract ? { type: contract.feeType, amount: contract.feeAmount } : null,
    participants,
    balances: { ...balances, revenue: regs.expectedRevenue },
    partners,
  }).figures

  const issues: ClosingIssue[] = []
  // A cancelled workshop keeps its status when closed: `closedAt` says its books are locked.
  if (course.status === "closed" || course.closedAt) issues.push("closed")
  else if (course.status !== "confirmed" && !cancelled) issues.push("notClosable")
  else if (course.status === "confirmed" && course.endsAt > now) issues.push("notEnded")
  if (course.status === "confirmed" && !contract) issues.push("noContract")
  // A refund owed is paid back (and booked) before the books close; anything else that differs is a mismatch.
  if (regs.refundsOwed > 0) issues.push("refundsOwed")
  if (balances.revenue - regs.refundsOwed !== regs.expectedRevenue) issues.push("revenueMismatch")
  issues.push(...plan.issues)

  return {
    status: course.status,
    closedAt: course.closedAt,
    closedTotals: course.closedTotals,
    contract,
    registrations: {
      confirmed: regs.confirmed,
      pending: regs.pending,
      expectedRevenue: regs.expectedRevenue,
      refundsOwed: regs.refundsOwed,
    },
    balances,
    partners,
    plan,
    projection,
    issues,
  }
}

export type ClosingPreview = NonNullable<Awaited<ReturnType<typeof prepareClosing>>>

/** What the admin saw in the closing preview: the result, the instructor's settlement and each partner's part. */
export type SeenFigures = Pick<ClosingFigures, "revenue" | "instructorFee" | "expenses" | "owedToInstructor"> & {
  partners: { adminId: string; shareBp: number; amount: number }[]
}

/** Anything different from the preview? Partners by position: `activePartners` keeps a stable order. */
function changedSince(seen: SeenFigures, now: ClosingFigures): boolean {
  return (
    seen.revenue !== now.revenue ||
    seen.instructorFee !== now.instructorFee ||
    seen.expenses !== now.expenses ||
    seen.owedToInstructor !== now.owedToInstructor ||
    seen.partners.length !== now.partners.length ||
    seen.partners.some((p, i) => {
      const q = now.partners[i]
      return p.adminId !== q.adminId || p.shareBp !== q.shareBp || p.amount !== q.amount
    })
  )
}

/**
 * Close a workshop: posts the settlement and the close (dated today, in
 * Istanbul), locks the figures in `closed_totals` and sets `closed_at`; a
 * confirmed workshop becomes "closed", a cancelled one stays "cancelled". Run
 * inside a transaction (audit in the same one). `expected`: the figures the
 * admin saw in the preview; if anything changed meanwhile (a payment, an
 * advance, the shares), nothing is posted and they are asked to look again.
 */
export async function closeCourse(
  tx: Tx,
  courseId: string,
  adminId: string,
  expected?: SeenFigures,
  now: Date = new Date(),
): Promise<ClosedTotals> {
  // The strongest lock first: postings and edits of this workshop wait for us.
  const [locked] = await tx.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId)).for("update")
  if (!locked) throw new UserError("money.errors.workshopGone")

  const prep = await prepareClosing(tx, courseId, now, true)
  if (!prep) throw new UserError("money.errors.workshopGone")
  if (prep.issues.length) throw new UserError(`money.close.issues.${prep.issues[0]}`)
  const { figures, settlement, close } = prep.plan
  if (expected && changedSince(expected, figures)) throw new UserError("money.close.changed")

  const base = { occurredOn: today(now), description: "", courseId, createdBy: adminId }
  if (settlement.length) await postTransaction(tx, { ...base, kind: "course_settlement", lines: settlement })
  if (close.length) await postTransaction(tx, { ...base, kind: "course_close", lines: close })

  const totals: ClosedTotals = {
    revenue: figures.revenue,
    instructorFee: figures.instructorFee,
    expenses: figures.expenses,
    netProfit: figures.netProfit,
    participants: figures.participants,
    partners: figures.partners,
  }
  await tx
    .update(courses)
    .set({ status: prep.status === "cancelled" ? "cancelled" : "closed", closedAt: now, closedTotals: totals, updatedAt: now })
    .where(eq(courses.id, courseId))
  return totals
}

/** Workshops that can be closed now (confirmed and over, or cancelled and not closed yet), oldest first. */
export async function workshopsToClose(exec: Exec = db, now: Date = new Date()) {
  return exec
    .select({ id: courses.id, title: courses.title, status: courses.status, endsAt: courses.endsAt })
    .from(courses)
    .where(
      sql`(${courses.status} = 'confirmed' and ${courses.endsAt} <= ${now}) or (${courses.status} = 'cancelled' and ${courses.closedAt} is null)`,
    )
    .orderBy(asc(courses.endsAt))
}

/**
 * The instructor fee each confirmed workshop will book when it is closed, by
 * workshop id: `instructorFee` on its live contract and final number (or, if
 * none is fixed, everyone registered, paid or not yet), as the closing preview
 * counts it. The ledger has no fee for a workshop until then,
 * so the reports and the result not yet shared out add these.
 */
export async function projectedFees(exec: Exec = db): Promise<Map<string, number>> {
  const id = sql`${courses}.${sql.identifier(courses.id.name)}`
  const live = exec
    .selectDistinctOn([contracts.courseId], { courseId: contracts.courseId, feeType: contracts.feeType, feeAmount: contracts.feeAmount })
    .from(contracts)
    .where(ne(contracts.status, "void"))
    .orderBy(contracts.courseId, desc(contracts.version))
    .as("live")
  const rows = await exec
    .select({
      id: courses.id,
      participants: sql<number>`coalesce(${courses.finalParticipants}, (select count(*) from ${registrations} r where r.course_id = ${id} and r.status in ('pending', 'confirmed')))`.mapWith(Number),
      feeType: live.feeType,
      feeAmount: live.feeAmount,
    })
    .from(courses)
    .leftJoin(live, eq(live.courseId, courses.id))
    .where(eq(courses.status, "confirmed"))
  return new Map(
    rows.map((r) => [
      r.id,
      instructorFee(false, r.feeType && r.feeAmount !== null ? { type: r.feeType, amount: r.feeAmount } : null, r.participants),
    ]),
  )
}

/** The sum of a map's amounts. */
export const totalOf = (amounts: Map<string, number>) => [...amounts.values()].reduce((s, a) => s + a, 0)
