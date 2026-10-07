import { randomUUID } from "node:crypto"
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, auditLog, ledgerLines, ledgerTransactions, registrations } from "@/db/schema"
import { splitByShares } from "@/lib/money"
import en from "../../../messages/en/money.json"
import { closeWorkshop, payInstructor, recordAdvance, recordExpense, reverseEntry, updateShares } from "./actions"
import { closingPlan, instructorFee, prepareClosing, projectedFees, workshopsToClose, type Partner } from "./closing"
import { courseBalances, partnerCapitals, postRegistrationPayment, postRegistrationRefund, today } from "./ledger"
import { isReversible, listTransactions } from "./queries"
import { partnerStatement, profitAndLoss, workshopResults } from "./reports"
import { addRegistration, courseRow, makeAdmin, makeCourse, makeWorld, retireAdmins, type World } from "./testing"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    money: (await import("../../../messages/en/money.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

const session = vi.hoisted(() => ({
  sessionId: "test",
  admin: { id: "", email: "", name: "Money Tester", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
const zero = { revenue: 0, instructorFees: 0, courseExpenses: 0, advance: 0, payable: 0 }
const two: Partner[] = [
  { adminId: "a", name: "A", shareBp: 5000 },
  { adminId: "b", name: "B", shareBp: 5000 },
]

describe("closingPlan (the math)", () => {
  it("settles a fixed fee against the advance and shares the profit", () => {
    const plan = closingPlan({
      cancelled: false,
      contract: { type: "fixed", amount: 100000 },
      participants: 10,
      balances: { ...zero, revenue: 500000, courseExpenses: 120000, advance: 30000 },
      partners: two,
    })
    expect(plan.issues).toEqual([])
    expect(plan.figures).toMatchObject({ revenue: 500000, instructorFee: 100000, expenses: 120000, netProfit: 280000 })
    expect(plan.figures.owedToInstructor).toBe(70000)
    expect(plan.settlement).toEqual([
      { account: "instructor_fees", amount: 100000 },
      { account: "instructor_advance", amount: -30000 },
      { account: "instructor_payable", amount: -70000 },
    ])
    expect(plan.close).toEqual([
      { account: "revenue", amount: 500000 },
      { account: "instructor_fees", amount: -100000 },
      { account: "course_expenses", amount: -120000 },
      { account: "partner_capital", partnerId: "a", amount: -140000 },
      { account: "partner_capital", partnerId: "b", amount: -140000 },
    ])
  })

  it("pays per participant on the final number", () => {
    expect(instructorFee(false, { type: "per_participant", amount: 15000 }, 8)).toBe(120000)
    expect(instructorFee(false, { type: "fixed", amount: 99000 }, 8)).toBe(99000)
    expect(instructorFee(true, { type: "fixed", amount: 99000 }, 8)).toBe(0)
    expect(instructorFee(false, null, 8)).toBe(0)
  })

  it("never loses a kuruş when sharing, for profits and losses", () => {
    const partners: Partner[] = [
      { adminId: "a", name: "A", shareBp: 3334 },
      { adminId: "b", name: "B", shareBp: 3333 },
      { adminId: "c", name: "C", shareBp: 3333 },
    ]
    for (const revenue of [1, 100, 99_999, 1_000_001, 0]) {
      for (const courseExpenses of [0, 7, 250_000]) {
        const plan = closingPlan({ cancelled: false, contract: null, participants: 0, balances: { ...zero, revenue, courseExpenses }, partners })
        const shared = plan.figures.partners.reduce((s, p) => s + p.amount, 0)
        expect(shared).toBe(plan.figures.netProfit)
        expect(plan.close.reduce((s, l) => s + l.amount, 0)).toBe(0)
        expect(plan.figures.partners.every((p) => !Object.is(p.amount, -0))).toBe(true)
      }
    }
    expect(splitByShares(100, [3334, 3333, 3333])).toEqual([34, 33, 33])
    expect(splitByShares(-100, [3334, 3333, 3333])).toEqual([-34, -33, -33])
  })

  it("debits the partners for a loss", () => {
    const plan = closingPlan({ cancelled: true, contract: { type: "fixed", amount: 50000 }, participants: 5, balances: { ...zero, courseExpenses: 5001 }, partners: two })
    expect(plan.figures).toMatchObject({ instructorFee: 0, participants: 0, netProfit: -5001 })
    expect(plan.settlement).toEqual([])
    expect(plan.close).toEqual([
      { account: "course_expenses", amount: -5001 },
      { account: "partner_capital", partnerId: "a", amount: 2501 },
      { account: "partner_capital", partnerId: "b", amount: 2500 },
    ])
  })

  it("posts nothing for a cancelled workshop without money", () => {
    const plan = closingPlan({ cancelled: true, contract: null, participants: 0, balances: zero, partners: two })
    expect(plan).toMatchObject({ settlement: [], close: [], issues: [] })
  })

  it("refuses an advance larger than the fee, and shares that are not 100 %", () => {
    expect(closingPlan({ cancelled: false, contract: { type: "fixed", amount: 100 }, participants: 1, balances: { ...zero, advance: 101 }, partners: two }).issues).toEqual(["advanceTooBig"])
    expect(closingPlan({ cancelled: true, contract: { type: "fixed", amount: 100 }, participants: 1, balances: { ...zero, advance: 1 }, partners: two }).issues).toEqual(["advanceTooBig"])
    const uneven = closingPlan({ cancelled: true, contract: null, participants: 0, balances: zero, partners: [{ adminId: "a", name: "A", shareBp: 9000 }] })
    expect(uneven.issues).toEqual(["sharesNot100"])
    expect(uneven.figures.partners).toEqual([])
    expect(closingPlan({ cancelled: true, contract: null, participants: 0, balances: zero, partners: [] }).issues).toEqual(["sharesNot100"])
  })
})

// ─── Against the database, through the server actions ────────────────────────

let world: World
let p1: { id: string; name: string }
let p2: { id: string; name: string }
let p3: { id: string; name: string }
const extra: string[] = []

const lastAudit = async (entityId: string, action: string) =>
  (
    await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)))
      .orderBy(desc(auditLog.at))
  )[0]

/** Course P&L accounts including the closing entry: all zero once closed. */
async function plAfterClose(courseId: string) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${ledgerLines.amount}), 0)`.mapWith(Number) })
    .from(ledgerLines)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerLines.transactionId))
    .where(
      and(
        eq(ledgerTransactions.courseId, courseId),
        inArray(ledgerLines.account, ["revenue", "instructor_fees", "course_expenses", "instructor_advance"]),
      ),
    )
  return row.total
}

const ok = <T>(result: { ok: true; data: T } | { ok: false; error: string }) => {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

/** What the close dialog sends: the figures of the preview the admin is looking at. */
async function previewOf(courseId: string) {
  const { figures } = (await prepareClosing(db, courseId))!.plan
  return {
    courseId,
    revenue: figures.revenue,
    instructorFee: figures.instructorFee,
    expenses: figures.expenses,
    owedToInstructor: figures.owedToInstructor,
    partners: figures.partners.map(({ adminId, shareBp, amount }) => ({ adminId, shareBp, amount })),
  }
}

/** Dates of a workshop's closing entries. */
async function closingDates(courseId: string) {
  const rows = await db
    .select({ occurredOn: ledgerTransactions.occurredOn })
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.courseId, courseId), inArray(ledgerTransactions.kind, ["course_settlement", "course_close"])))
  return rows.map((r) => r.occurredOn)
}

beforeAll(async () => {
  p1 = await makeAdmin("Partner One")
  p2 = await makeAdmin("Partner Two")
  p3 = await makeAdmin("Partner Three")
  session.admin.id = p1.id
  world = await makeWorld()
})

afterAll(async () => {
  await retireAdmins([p1.id, p2.id, p3.id, ...extra])
})

describe("updateShares", () => {
  it("must add up to 100 % for one to three active partners", async () => {
    const short = await updateShares({ shares: [{ adminId: p1.id, shareBp: 5000 }, { adminId: p2.id, shareBp: 4999 }] })
    expect(short).toMatchObject({ ok: false, fieldErrors: { shares: en.partners.sumError } })
    const four = await updateShares({
      shares: [p1, p2, p3, { id: randomUUID() }].map((p) => ({ adminId: p.id, shareBp: 2500 })),
    })
    expect(four.ok).toBe(false)
    const left = await makeAdmin("Left")
    extra.push(left.id)
    await retireAdmins([left.id])
    expect(await updateShares({ shares: [{ adminId: p1.id, shareBp: 5000 }, { adminId: left.id, shareBp: 5000 }] })).toEqual({
      ok: false,
      error: en.partners.partnerGone,
    })
  })

  it("sets the listed shares, zeroes everyone else and audits the change", async () => {
    const stale = await makeAdmin("Stale", 4000)
    extra.push(stale.id)
    ok(
      await updateShares({
        shares: [
          { adminId: p1.id, shareBp: 5000 },
          { adminId: p2.id, shareBp: 3000 },
          { adminId: p3.id, shareBp: 2000 },
        ],
      }),
    )
    const rows = await db.select({ id: admins.id, shareBp: admins.shareBp }).from(admins).where(ne(admins.shareBp, 0))
    expect(Object.fromEntries(rows.map((r) => [r.id, r.shareBp]))).toEqual({ [p1.id]: 5000, [p2.id]: 3000, [p3.id]: 2000 })
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "partner.shares")).orderBy(desc(auditLog.at)).limit(1)
    expect(entry.adminId).toBe(p1.id)
    expect(entry.data).toMatchObject({ [stale.id]: { from: 4000, to: 0 }, [p1.id]: { from: 0, to: 5000 } })

    // Uneven thirds: the rounding test below relies on these.
    ok(
      await updateShares({
        shares: [
          { adminId: p1.id, shareBp: 3334 },
          { adminId: p2.id, shareBp: 3333 },
          { adminId: p3.id, shareBp: 3333 },
        ],
      }),
    )
  })
})

describe("closing a workshop", () => {
  it("closes a confirmed per-participant workshop with the exact figures of the preview", async () => {
    const courseId = await makeCourse(world, p1.id, {
      finalParticipants: 3,
      fee: { type: "per_participant", amount: 20000, advance: 10000 },
    })
    // Three paid places, and one paid then refunded in full.
    const regs = [
      await addRegistration(world, courseId),
      await addRegistration(world, courseId),
      await addRegistration(world, courseId),
    ]
    const refunded = await addRegistration(world, courseId, { status: "cancelled", refundAmount: 50000, refundedAt: new Date() })
    await db.transaction(async (tx) => {
      for (const registrationId of [...regs, refunded]) await postRegistrationPayment(tx, { registrationId, occurredOn: yesterday() })
      await postRegistrationRefund(tx, { registrationId: refunded, amount: 50000, occurredOn: yesterday() })
    })
    ok(await recordAdvance({ courseId, direction: "paid", amount: 10000, occurredOn: yesterday(), source: "wallet", note: "" }))
    ok(await recordExpense({ courseId, category: "Clay", amount: 20000, occurredOn: yesterday(), source: "wallet" }))
    ok(await recordExpense({ courseId, category: "Tea", amount: 5000, occurredOn: yesterday(), source: p2.id }))

    const preview = (await prepareClosing(db, courseId))!
    expect(preview.issues).toEqual([])
    expect(preview.plan.figures).toMatchObject({
      revenue: 150000,
      instructorFee: 60000,
      expenses: 25000,
      netProfit: 65000,
      participants: 3,
      advance: 10000,
      owedToInstructor: 50000,
    })
    // 65000 by 33.34 / 33.33 / 33.33 %: the odd kuruş goes to the largest share.
    expect(preview.plan.figures.partners.map((p) => [p.adminId, p.amount])).toEqual([
      [p1.id, 21672],
      [p2.id, 21664],
      [p3.id, 21664],
    ])

    const capitalBefore = await partnerCapitals()
    const seen = await previewOf(courseId)
    expect(await closeWorkshop({ ...seen, expenses: 24999 })).toEqual({ ok: false, error: en.close.changed })
    expect(ok(await closeWorkshop(seen))).toEqual({ netProfit: 65000 })

    const course = await courseRow(courseId)
    expect(course.status).toBe("closed")
    expect(course.closedAt).toBeInstanceOf(Date)
    expect(course.closedTotals).toEqual({
      revenue: 150000,
      instructorFee: 60000,
      expenses: 25000,
      netProfit: 65000,
      participants: 3,
      partners: [
        { adminId: p1.id, name: "Partner One", shareBp: 3334, amount: 21672 },
        { adminId: p2.id, name: "Partner Two", shareBp: 3333, amount: 21664 },
        { adminId: p3.id, name: "Partner Three", shareBp: 3333, amount: 21664 },
      ],
    })
    expect(await plAfterClose(courseId)).toBe(0)
    expect(await closingDates(courseId)).toEqual([today(), today()]) // the day of closing, not the workshop's
    expect(await courseBalances(db, courseId)).toMatchObject({ advance: 0, payable: 50000 })
    const capitalAfter = await partnerCapitals()
    expect(capitalAfter.get(p1.id)!.profitShares - (capitalBefore.get(p1.id)?.profitShares ?? 0)).toBe(21672)
    expect(capitalAfter.get(p3.id)!.capital - (capitalBefore.get(p3.id)?.capital ?? 0)).toBe(21664)
    expect(await lastAudit(courseId, "workshop.close")).toMatchObject({ adminId: p1.id, data: { netProfit: 65000 } })

    // Locked: no more expenses, no second closing, no reversing the closing entry.
    expect(await recordExpense({ courseId, category: "Late", amount: 100, occurredOn: yesterday(), source: "wallet" })).toEqual({
      ok: false,
      error: en.errors.workshopClosed,
    })
    expect(await closeWorkshop(seen)).toEqual({ ok: false, error: en.close.issues.closed })
    const [closing] = await db
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(and(eq(ledgerTransactions.courseId, courseId), eq(ledgerTransactions.kind, "course_close")))
    expect(await reverseEntry({ id: closing.id })).toEqual({ ok: false, error: en.errors.closingIsFinal })

    // The instructor is paid what is still owed, and not a kuruş more.
    expect((await payInstructor({ courseId, amount: 50001, occurredOn: yesterday(), source: "wallet", note: "" })).ok).toBe(false)
    ok(await payInstructor({ courseId, amount: 50000, occurredOn: yesterday(), source: "wallet", note: "IBAN" }))
    expect((await courseBalances(db, courseId)).payable).toBe(0)
  })

  it("closes a fixed-fee workshop that made a loss", async () => {
    const courseId = await makeCourse(world, p1.id, { fee: { type: "fixed", amount: 30001 } })
    const preview = (await prepareClosing(db, courseId))!
    expect(preview.plan.figures).toMatchObject({ revenue: 0, instructorFee: 30001, netProfit: -30001, owedToInstructor: 30001 })
    ok(await closeWorkshop(await previewOf(courseId)))
    const totals = (await courseRow(courseId)).closedTotals!
    expect(totals.partners.map((p) => p.amount)).toEqual([-10003, -9999, -9999])
    expect(await plAfterClose(courseId)).toBe(0)
  })

  it("needs the advance of a cancelled workshop returned or spent first, and keeps it cancelled once closed", async () => {
    const courseId = await makeCourse(world, p1.id, { status: "published", fee: { type: "fixed", amount: 80000, advance: 20000 } })
    ok(await recordAdvance({ courseId, direction: "paid", amount: 20000, occurredOn: yesterday(), source: p3.id, note: "" }))
    await db.execute(sql`update courses set status = 'cancelled', cancelled_at = now() where id = ${courseId}`)

    expect(await closeWorkshop(await previewOf(courseId))).toEqual({ ok: false, error: en.close.issues.advanceTooBig })
    // Clause 6.4: materials bought from the advance are set off; the rest comes back.
    ok(await recordExpense({ courseId, category: "Materials", amount: 15000, occurredOn: yesterday(), source: "advance" }))
    ok(await recordAdvance({ courseId, direction: "returned", amount: 5000, occurredOn: yesterday(), source: "wallet", note: "" }))

    const preview = (await prepareClosing(db, courseId))!
    expect(preview.issues).toEqual([])
    expect(preview.plan.settlement).toEqual([])
    expect((await workshopsToClose(db)).map((w) => w.id)).toContain(courseId)
    const seen = await previewOf(courseId)
    ok(await closeWorkshop(seen))
    const course = await courseRow(courseId)
    expect(course.closedTotals).toMatchObject({ instructorFee: 0, participants: 0, netProfit: -15000 })
    expect(await plAfterClose(courseId)).toBe(0)

    // Still a cancelled workshop (never "held"), but its books are locked.
    expect(course.status).toBe("cancelled")
    expect(course.closedAt).toBeInstanceOf(Date)
    expect((await workshopsToClose(db)).map((w) => w.id)).not.toContain(courseId)
    expect((await prepareClosing(db, courseId))!.issues).toContain("closed")
    expect(await closeWorkshop(seen)).toEqual({ ok: false, error: en.close.issues.closed })
    expect(await recordExpense({ courseId, category: "Late", amount: 100, occurredOn: yesterday(), source: "wallet" })).toEqual({
      ok: false,
      error: en.errors.workshopClosed,
    })
    const { rows } = await listTransactions(
      { q: "", sort: "occurredOn", dir: "desc", page: 1, pageSize: 20, offset: 0, filters: { workshop: courseId } },
      {},
    )
    const expense = rows.find((r) => r.kind === "expense")!
    expect(expense).toMatchObject({ courseStatus: "cancelled" })
    expect(isReversible(expense)).toBe(false)
    expect(await reverseEntry({ id: expense.id })).toEqual({ ok: false, error: en.errors.workshopClosed })
  })

  it("waits until a confirmed workshop has ended", async () => {
    const courseId = await makeCourse(world, p1.id, { endsAt: new Date(Date.now() + 3_600_000) })
    expect(await closeWorkshop(await previewOf(courseId))).toEqual({
      ok: false,
      error: en.close.issues.notEnded,
    })
    const published = await makeCourse(world, p1.id, { status: "published" })
    expect((await prepareClosing(db, published))!.issues).toContain("notClosable")
  })

  it("waits until every payment and refund is in the books", async () => {
    const courseId = await makeCourse(world, p1.id)
    await addRegistration(world, courseId) // paid, but no payment posted
    expect((await prepareClosing(db, courseId))!.issues).toEqual(["revenueMismatch"])
    expect(await closeWorkshop(await previewOf(courseId))).toEqual({
      ok: false,
      error: en.close.issues.revenueMismatch,
    })
  })

  it("asks to pay back the refunds still owed first, not about a mismatch", async () => {
    const courseId = await makeCourse(world, p1.id, { fee: { type: "fixed", amount: 10000 } })
    const cancelled = await addRegistration(world, courseId, { status: "cancelled", refundAmount: 25000 })
    await db.transaction((tx) => postRegistrationPayment(tx, { registrationId: cancelled, occurredOn: yesterday() }))
    const preview = (await prepareClosing(db, courseId))!
    expect(preview.issues).toEqual(["refundsOwed"])
    expect(preview.registrations.refundsOwed).toBe(25000)
    expect(await closeWorkshop(await previewOf(courseId))).toEqual({ ok: false, error: en.close.issues.refundsOwed })

    // Paid back and booked: nothing left in the way.
    await db.transaction((tx) => postRegistrationRefund(tx, { registrationId: cancelled, amount: 25000, occurredOn: yesterday() }))
    await db.update(registrations).set({ refundedAt: new Date() }).where(eq(registrations.id, cancelled))
    expect((await prepareClosing(db, courseId))!.issues).toEqual([])
  })

  it("counts everyone registered, paid or not yet, until the go decision fixes the number", async () => {
    const courseId = await makeCourse(world, p1.id, { fee: { type: "per_participant", amount: 10000 } })
    await addRegistration(world, courseId, { status: "pending" })
    await addRegistration(world, courseId, { status: "pending" })
    await addRegistration(world, courseId, { status: "cancelled", refundAmount: 0 })
    const preview = (await prepareClosing(db, courseId))!
    expect(preview.plan.figures).toMatchObject({ participants: 2, instructorFee: 20000 })
    expect((await projectedFees(db)).get(courseId)).toBe(20000)
  })
})

describe("closing: what the admin saw", () => {
  const thirds = [
    { adminId: "", shareBp: 3334 },
    { adminId: "", shareBp: 3333 },
    { adminId: "", shareBp: 3333 },
  ]
  const restoreThirds = async () =>
    ok(await updateShares({ shares: [p1, p2, p3].map((p, i) => ({ ...thirds[i], adminId: p.id })) }))

  it("refuses to close when the shares changed after the preview", async () => {
    const courseId = await makeCourse(world, p1.id, { fee: { type: "fixed", amount: 100000 } })
    const seen = await previewOf(courseId)
    expect(seen.partners.map((p) => p.amount)).toEqual([-33340, -33330, -33330])
    try {
      ok(await updateShares({ shares: [{ adminId: p1.id, shareBp: 9000 }, { adminId: p2.id, shareBp: 1000 }] }))
      expect(await closeWorkshop(seen)).toEqual({ ok: false, error: en.close.changed })
      expect(await courseRow(courseId)).toMatchObject({ status: "confirmed", closedAt: null })
      // Looking again shows the new split, which then closes.
      const again = await previewOf(courseId)
      expect(again.partners).toEqual([
        { adminId: p1.id, shareBp: 9000, amount: -90000 },
        { adminId: p2.id, shareBp: 1000, amount: -10000 },
      ])
      ok(await closeWorkshop(again))
      expect((await courseRow(courseId)).closedTotals!.partners.map((p) => p.amount)).toEqual([-90000, -10000])
    } finally {
      await restoreThirds()
    }
  })

  it("refuses to close when an advance was returned after the preview", async () => {
    const courseId = await makeCourse(world, p1.id, { fee: { type: "fixed", amount: 100000, advance: 30000 } })
    ok(await recordAdvance({ courseId, direction: "paid", amount: 30000, occurredOn: yesterday(), source: "wallet", note: "" }))
    const seen = await previewOf(courseId)
    expect(seen.owedToInstructor).toBe(70000)

    ok(await recordAdvance({ courseId, direction: "returned", amount: 10000, occurredOn: yesterday(), source: "wallet", note: "" }))
    expect(await closeWorkshop(seen)).toEqual({ ok: false, error: en.close.changed })
    expect(await courseRow(courseId)).toMatchObject({ status: "confirmed", closedAt: null })
    const again = await previewOf(courseId)
    expect(again).toMatchObject({ revenue: seen.revenue, instructorFee: seen.instructorFee, expenses: seen.expenses, owedToInstructor: 80000 })
    ok(await closeWorkshop(again))
  })
})

describe("closing: earlier periods never change", () => {
  // A month no other test posts to; the ledger keeps rows from earlier runs, so compare before and after.
  const june = { from: "2004-06-01", to: "2004-06-30" }

  it("counts the projected fee before closing and dates the closing entries on the day of closing", async () => {
    const courseId = await makeCourse(world, p1.id, { endsAt: new Date("2004-06-15T15:00:00Z"), fee: { type: "fixed", amount: 100000 } })
    const registrationId = await addRegistration(world, courseId, { amount: 500000 })
    await db.transaction((tx) => postRegistrationPayment(tx, { registrationId, occurredOn: "2004-06-15" }))
    // Paid a week after the workshop, personally by a partner.
    ok(await recordExpense({ courseId, category: "Clay", amount: 50000, occurredOn: "2004-06-22", source: p2.id }))

    const result = async () => (await workshopResults(june)).workshops.find((w) => w.id === courseId)
    expect((await prepareClosing(db, courseId))!.projection.netProfit).toBe(350000)
    expect((await projectedFees(db)).get(courseId)).toBe(100000)
    // Before closing, the report already counts the fee the workshop will owe.
    expect(await result()).toMatchObject({ revenue: 500000, instructorFees: 100000, estimatedFee: 100000, courseExpenses: 50000, net: 350000 })
    const pnl = await profitAndLoss({ ...june, group: "month" })
    const statement = await partnerStatement(p2.id, june)
    expect(statement!.movements.map((m) => [m.occurredOn, m.kind, m.amount])).toEqual([["2004-06-22", "expense", 50000]])

    ok(await closeWorkshop(await previewOf(courseId)))

    expect(await closingDates(courseId)).toEqual([today(), today()])
    // The same result, now booked; June (already reported) is unchanged.
    expect(await result()).toMatchObject({ instructorFees: 100000, estimatedFee: 0, net: 350000 })
    expect(await profitAndLoss({ ...june, group: "month" })).toEqual(pnl)
    expect(await partnerStatement(p2.id, june)).toEqual(statement)
    expect((await projectedFees(db)).has(courseId)).toBe(false)
  })
})

describe("reverseEntry", () => {
  it("reverses an expense and audits it", async () => {
    const courseId = await makeCourse(world, p1.id, { status: "published" })
    const { id } = ok(await recordExpense({ courseId, category: "Flyers", amount: 4200, occurredOn: yesterday(), source: "wallet" }))
    expect(await lastAudit(id, "money.expense")).toMatchObject({ adminId: p1.id, data: { category: "Flyers", amount: 4200 } })
    const reversal = ok(await reverseEntry({ id }))
    expect((await courseBalances(db, courseId)).courseExpenses).toBe(0)
    expect(await lastAudit(id, "money.reverse")).toMatchObject({ data: { reversalId: reversal.id, kind: "expense" } })
    expect(await reverseEntry({ id })).toEqual({ ok: false, error: en.errors.alreadyReversed })
  })

  it("rejects a malformed id and validates amounts and dates", async () => {
    expect((await reverseEntry({ id: "../x" })).ok).toBe(false)
    const result = await recordExpense({ courseId: null, category: "x", amount: 0, occurredOn: "2999-01-01", source: "wallet" })
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { amount: en.validation.amountPositive, occurredOn: en.validation.notInFuture },
    })
  })
})
