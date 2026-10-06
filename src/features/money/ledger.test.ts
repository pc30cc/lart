import { randomUUID } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db, type Tx } from "@/db"
import { account, courses, ledgerLines, ledgerTransactions, transactionKind } from "@/db/schema"
import { UserError } from "@/lib/errors"
import {
  checkPosting,
  courseBalances,
  LedgerError,
  partnerCapitals,
  postAdvance,
  postContribution,
  postExpense,
  postInstructorPayment,
  postRegistrationPayment,
  postRegistrationRefund,
  postTransaction,
  postWithdrawal,
  registrationMoney,
  reverseTransaction,
  walletBalance,
  type Posting,
} from "./ledger"
import { accounts, transactionKinds } from "./schema"
import { addRegistration, makeAdmin, makeCourse, makeWorld, retireAdmins, type World } from "./testing"

const day = "2026-09-15"
let world: World
let alice: { id: string; name: string }
let bob: { id: string; name: string }
let gone: { id: string; name: string }

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => db.transaction(fn)
const common = () => ({ occurredOn: day, description: "test", createdBy: alice.id })

/** The UserError key a promise rejects with. */
async function userError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (err) {
    if (err instanceof UserError) return err.key
    throw err
  }
  throw new Error("expected a UserError")
}

/** What some transactions did to the wallet (other test files post in parallel, so no global before/after). */
async function walletChange(ids: string[]) {
  const rows = await db
    .select({ amount: ledgerLines.amount })
    .from(ledgerLines)
    .where(and(inArray(ledgerLines.transactionId, ids), eq(ledgerLines.account, "wallet")))
  return rows.reduce((s, r) => s + r.amount, 0)
}

async function linesOf(transactionId: string) {
  return db
    .select({ account: ledgerLines.account, partnerId: ledgerLines.partnerId, amount: ledgerLines.amount })
    .from(ledgerLines)
    .where(eq(ledgerLines.transactionId, transactionId))
    .orderBy(ledgerLines.amount)
}

beforeAll(async () => {
  alice = await makeAdmin("Alice")
  bob = await makeAdmin("Bob")
  gone = await makeAdmin("Gone")
  await retireAdmins([gone.id])
  world = await makeWorld()
})

afterAll(async () => {
  await retireAdmins([alice.id, bob.id])
})

describe("checkPosting (structure)", () => {
  const base = (lines: Posting["lines"], extra: Partial<Posting> = {}): Posting => ({
    kind: "capital_contribution",
    occurredOn: day,
    description: "",
    createdBy: null,
    lines,
    ...extra,
  })
  const partner = randomUUID()

  it("accepts a balanced, well-formed posting", () => {
    expect(() =>
      checkPosting(base([{ account: "wallet", amount: 100 }, { account: "partner_capital", partnerId: partner, amount: -100 }])),
    ).not.toThrow()
  })

  it.each([
    ["unbalanced", base([{ account: "wallet", amount: 100 }, { account: "partner_capital", partnerId: partner, amount: -99 }])],
    ["one line", base([{ account: "wallet", amount: 0 }])],
    ["a zero line", base([{ account: "wallet", amount: 0 }, { account: "partner_capital", partnerId: partner, amount: 0 }])],
    ["fractions", base([{ account: "wallet", amount: 1.5 }, { account: "partner_capital", partnerId: partner, amount: -1.5 }])],
    ["capital without partner", base([{ account: "wallet", amount: 1 }, { account: "partner_capital", amount: -1 }])],
    ["partner on another account", base([{ account: "wallet", amount: 1, partnerId: partner }, { account: "partner_capital", partnerId: partner, amount: -1 }])],
    ["account not allowed for the kind", base([{ account: "revenue", amount: -1 }, { account: "wallet", amount: 1 }], { courseId: partner })],
    ["workshop account without workshop", base([{ account: "wallet", amount: 1 }, { account: "revenue", amount: -1 }], { kind: "registration_payment" })],
    ["general expense of a workshop", base([{ account: "general_expenses", amount: 1 }, { account: "wallet", amount: -1 }], { kind: "expense", courseId: partner })],
    ["a bad date", base([{ account: "wallet", amount: 1 }, { account: "partner_capital", partnerId: partner, amount: -1 }], { occurredOn: "2026-02-30" })],
  ])("refuses %s", (_label, posting) => {
    expect(() => checkPosting(posting)).toThrow(LedgerError)
  })

  it("lists the same kinds and accounts as the database enums", () => {
    expect([...transactionKinds]).toEqual(transactionKind.enumValues)
    expect([...accounts]).toEqual(account.enumValues)
  })
})

describe("database guards", () => {
  it("rejects an unbalanced transaction even when the code is bypassed", async () => {
    await expect(
      inTx(async (tx) => {
        const [row] = await tx
          .insert(ledgerTransactions)
          .values({ kind: "capital_contribution", occurredOn: day, description: "raw", createdBy: alice.id })
          .returning({ id: ledgerTransactions.id })
        await tx.insert(ledgerLines).values([
          { transactionId: row.id, account: "wallet", amount: 100 },
          { transactionId: row.id, account: "partner_capital", partnerId: alice.id, amount: -90 },
        ])
      }),
    ).rejects.toThrow()
  })

  it("never lets a ledger row change", async () => {
    const id = await inTx((tx) => postContribution(tx, { ...common(), partnerId: alice.id, amount: 1 }))
    await expect(db.update(ledgerTransactions).set({ description: "x" }).where(eq(ledgerTransactions.id, id))).rejects.toThrow()
    await expect(db.delete(ledgerLines).where(eq(ledgerLines.transactionId, id))).rejects.toThrow()
  })
})

describe("walletBalance", () => {
  it("is the sum of all wallet lines", async () => {
    await inTx(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read`)
      const before = await walletBalance(tx)
      await postContribution(tx, { ...common(), partnerId: alice.id, amount: 4321 })
      expect((await walletBalance(tx)) - before).toBe(4321)
    })
  })
})

describe("standard postings", () => {
  it("contribution and withdrawal move the wallet and the partner's capital", async () => {
    const partner = await makeAdmin("Capital")
    const id = await inTx((tx) => postContribution(tx, { ...common(), partnerId: partner.id, amount: 500000 }))
    expect(await linesOf(id)).toEqual([
      { account: "partner_capital", partnerId: partner.id, amount: -500000 },
      { account: "wallet", partnerId: null, amount: 500000 },
    ])
    const out = await inTx((tx) => postWithdrawal(tx, { ...common(), partnerId: partner.id, amount: 120000 }))
    expect(await walletChange([id, out])).toBe(380000)
    expect((await partnerCapitals()).get(partner.id)).toEqual({
      partnerId: partner.id,
      contributions: 500000,
      withdrawals: 120000,
      paidForBusiness: 0,
      profitShares: 0,
      capital: 380000,
    })
    await retireAdmins([partner.id])
  })

  it("refuses new entries for a partner who has left", async () => {
    expect(await userError(inTx((tx) => postContribution(tx, { ...common(), partnerId: gone.id, amount: 100 })))).toBe(
      "money.errors.partnerInactive",
    )
  })

  it("records expenses paid from the wallet or by a partner", async () => {
    const courseId = await makeCourse(world, alice.id, { status: "published" })
    const general = await inTx((tx) => postExpense(tx, { ...common(), amount: 3000, source: "wallet" }))
    expect(await linesOf(general)).toEqual([
      { account: "wallet", partnerId: null, amount: -3000 },
      { account: "general_expenses", partnerId: null, amount: 3000 },
    ])
    const byPartner = await inTx((tx) =>
      postExpense(tx, { ...common(), courseId, amount: 7000, source: { partnerId: bob.id } }),
    )
    expect(await linesOf(byPartner)).toEqual([
      { account: "partner_capital", partnerId: bob.id, amount: -7000 },
      { account: "course_expenses", partnerId: null, amount: 7000 },
    ])
    expect(await walletChange([general, byPartner])).toBe(-3000)
    expect(await courseBalances(db, courseId)).toMatchObject({ courseExpenses: 7000, revenue: 0 })
    expect((await partnerCapitals()).get(bob.id)?.paidForBusiness).toBeGreaterThanOrEqual(7000)
  })

  it("pays, returns and spends an advance, never below zero", async () => {
    const courseId = await makeCourse(world, alice.id, { status: "published" })
    await inTx((tx) => postAdvance(tx, { ...common(), courseId, amount: 40000, direction: "paid", source: "wallet" }))
    await inTx((tx) => postAdvance(tx, { ...common(), courseId, amount: 5000, direction: "returned", source: "wallet" }))
    const spent = await inTx((tx) => postExpense(tx, { ...common(), courseId, amount: 15000, source: "advance" }))
    expect(await linesOf(spent)).toEqual([
      { account: "instructor_advance", partnerId: null, amount: -15000 },
      { account: "course_expenses", partnerId: null, amount: 15000 },
    ])
    expect(await courseBalances(db, courseId)).toMatchObject({ advance: 20000, courseExpenses: 15000 })

    expect(
      await userError(inTx((tx) => postAdvance(tx, { ...common(), courseId, amount: 20001, direction: "returned", source: "wallet" }))),
    ).toBe("money.errors.moreThanAdvance")
    expect(await userError(inTx((tx) => postExpense(tx, { ...common(), courseId, amount: 20001, source: "advance" })))).toBe(
      "money.errors.moreThanAdvance",
    )
  })

  it("does not pay an advance for a cancelled workshop", async () => {
    const courseId = await makeCourse(world, alice.id, { status: "cancelled" })
    expect(
      await userError(inTx((tx) => postAdvance(tx, { ...common(), courseId, amount: 100, direction: "paid", source: "wallet" }))),
    ).toBe("money.errors.advanceNotNow")
  })

  it("never pays an instructor more than is owed", async () => {
    const courseId = await makeCourse(world, alice.id)
    expect(
      await userError(inTx((tx) => postInstructorPayment(tx, { ...common(), courseId, amount: 1, source: "wallet" }))),
    ).toBe("money.errors.moreThanOwed")
  })

  it("posts registration payments and refunds from the registration, once", async () => {
    const courseId = await makeCourse(world, alice.id, { status: "published" })
    const registrationId = await addRegistration(world, courseId, { amount: 65000 })
    const paid = await inTx((tx) => postRegistrationPayment(tx, { registrationId, occurredOn: day }))
    expect(await linesOf(paid)).toEqual([
      { account: "revenue", partnerId: null, amount: -65000 },
      { account: "wallet", partnerId: null, amount: 65000 },
    ])
    expect(await userError(inTx((tx) => postRegistrationPayment(tx, { registrationId, occurredOn: day })))).toBe(
      "money.errors.alreadyPaid",
    )
    const refund = await inTx((tx) =>
      postRegistrationRefund(tx, { registrationId, amount: 32500, occurredOn: day, createdBy: alice.id }),
    )
    expect(
      await userError(inTx((tx) => postRegistrationRefund(tx, { registrationId, amount: 32501, occurredOn: day }))),
    ).toBe("money.errors.moreThanPaid")
    expect(await registrationMoney(db, registrationId)).toEqual({ paid: 65000, refunded: 32500 })
    expect(await courseBalances(db, courseId)).toMatchObject({ revenue: 32500 })
    expect(await walletChange([paid, refund])).toBe(32500)
  })
})

describe("closed workshops", () => {
  it("accept no more expenses, advances or revenue, but the instructor can still be paid", async () => {
    const courseId = await makeCourse(world, alice.id)
    // Owe the instructor 1000 as a closing would, then mark the workshop closed.
    await inTx((tx) =>
      postTransaction(tx, {
        kind: "course_settlement",
        ...common(),
        courseId,
        lines: [
          { account: "instructor_fees", amount: 1000 },
          { account: "instructor_payable", amount: -1000 },
        ],
      }),
    )
    await db.update(courses).set({ status: "closed" }).where(eq(courses.id, courseId))

    expect(await userError(inTx((tx) => postExpense(tx, { ...common(), courseId, amount: 100, source: "wallet" })))).toBe(
      "money.errors.workshopClosed",
    )
    await inTx((tx) => postInstructorPayment(tx, { ...common(), courseId, amount: 600, source: "wallet" }))
    expect((await courseBalances(db, courseId)).payable).toBe(400)
  })
})

describe("reverseTransaction", () => {
  it("posts the mirror image and puts every balance back", async () => {
    const id = await inTx((tx) => postContribution(tx, { ...common(), partnerId: alice.id, amount: 9900 }))
    const capitalBefore = (await partnerCapitals()).get(alice.id)!
    const reversal = await reverseTransaction(id, bob.id, { occurredOn: "2026-09-20" })
    expect(reversal.original.kind).toBe("capital_contribution")
    expect(await linesOf(reversal.id)).toEqual([
      { account: "wallet", partnerId: null, amount: -9900 },
      { account: "partner_capital", partnerId: alice.id, amount: 9900 },
    ])
    const [row] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, reversal.id))
    expect(row).toMatchObject({ kind: "reversal", reversalOf: id, createdBy: bob.id, occurredOn: "2026-09-20" })
    expect(await walletChange([id, reversal.id])).toBe(0)
    // The reversal counts as a smaller contribution, not as something else.
    const after = (await partnerCapitals()).get(alice.id)!
    expect(after.contributions).toBe(capitalBefore.contributions - 9900)
    expect(after.capital).toBe(capitalBefore.capital - 9900)
  })

  it("never reverses twice, never a reversal, never a closing entry", async () => {
    const id = await inTx((tx) => postContribution(tx, { ...common(), partnerId: alice.id, amount: 100 }))
    const reversal = await reverseTransaction(id, alice.id)
    expect(await userError(reverseTransaction(id, alice.id))).toBe("money.errors.alreadyReversed")
    expect(await userError(reverseTransaction(reversal.id, alice.id))).toBe("money.errors.cannotReverseReversal")

    const courseId = await makeCourse(world, alice.id)
    const settlement = await inTx((tx) =>
      postTransaction(tx, {
        kind: "course_settlement",
        ...common(),
        courseId,
        lines: [
          { account: "instructor_fees", amount: 100 },
          { account: "instructor_payable", amount: -100 },
        ],
      }),
    )
    expect(await userError(reverseTransaction(settlement, alice.id))).toBe("money.errors.closingIsFinal")
    expect(await userError(reverseTransaction(randomUUID(), alice.id))).toBe("money.errors.entryGone")
  })

  it("lets two admins race: only one reversal is written", async () => {
    const id = await inTx((tx) => postContribution(tx, { ...common(), partnerId: alice.id, amount: 100 }))
    const results = await Promise.allSettled([reverseTransaction(id, alice.id), reverseTransaction(id, bob.id)])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.reversalOf, id))
    expect(n).toBe(1)
  })

  it("asks to undo later entries first rather than leave a negative advance", async () => {
    const courseId = await makeCourse(world, alice.id, { status: "published" })
    const paid = await inTx((tx) =>
      postAdvance(tx, { ...common(), courseId, amount: 1000, direction: "paid", source: "wallet" }),
    )
    const returned = await inTx((tx) =>
      postAdvance(tx, { ...common(), courseId, amount: 1000, direction: "returned", source: "wallet" }),
    )
    expect(await userError(reverseTransaction(paid, alice.id))).toBe("money.errors.reverseLaterFirst")
    await reverseTransaction(returned, alice.id)
    await reverseTransaction(paid, alice.id)
    expect((await courseBalances(db, courseId)).advance).toBe(0)
  })

  it("can correct an entry of a partner who has left", async () => {
    const leaving = await makeAdmin("Leaving")
    const id = await inTx((tx) => postContribution(tx, { ...common(), partnerId: leaving.id, amount: 700 }))
    await retireAdmins([leaving.id])
    await reverseTransaction(id, alice.id)
    expect((await partnerCapitals()).get(leaving.id)?.capital).toBe(0)
  })

  it("refuses to change the figures of a closed workshop", async () => {
    const courseId = await makeCourse(world, alice.id)
    const expense = await inTx((tx) => postExpense(tx, { ...common(), courseId, amount: 500, source: "wallet" }))
    await db.update(courses).set({ status: "closed" }).where(eq(courses.id, courseId))
    expect(await userError(reverseTransaction(expense, alice.id))).toBe("money.errors.workshopClosed")
  })
})
