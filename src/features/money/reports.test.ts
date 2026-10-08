import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db, type Tx } from "@/db"
import { courses } from "@/db/schema"
import { csvCell, lira, toCsv } from "./csv"
import {
  postContribution,
  postExpense,
  postRegistrationPayment,
  postTransaction,
  postWithdrawal,
  reverseTransaction,
} from "./ledger"
import { instructorResults, ledgerExport, partnerStatement, profitAndLoss, workshopResults } from "./reports"
import { addRegistration, makeAdmin, makeCourse, makeWorld, retireAdmins } from "./testing"

const session = vi.hoisted(() => ({ sessionId: "test", admin: { id: "", email: "", name: "Reports", shareBp: 0 } }))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => db.transaction(fn)
const YEAR = { from: "2003-01-01", to: "2003-12-31" }

describe("csv", () => {
  it("defuses formulas and quotes what needs quoting", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`)
    for (const start of ["+", "-", "@", "\t", "\r"]) expect(csvCell(`${start}1`).replace(/^"/, "").startsWith(`'${start}`)).toBe(true)
    expect(csvCell("Kira, salon")).toBe(`"Kira, salon"`)
    expect(csvCell("satır\nsatır")).toBe(`"satır\nsatır"`)
    expect(csvCell("Seramik atölyesi")).toBe("Seramik atölyesi")
    expect(csvCell(-1250.5)).toBe("-1250.5")
    expect(csvCell(null)).toBe("")
    expect(csvCell(Number.NaN)).toBe("")
  })

  it("writes a BOM, commas and CRLF", () => {
    expect(toCsv([["a", 1], ["b", lira(125007)]])).toBe("\uFEFFa,1\r\nb,1250.07\r\n")
  })
})

describe("reports", () => {
  let partner: { id: string; name: string }
  let courseId: string
  let general: string
  let world: Awaited<ReturnType<typeof makeWorld>>
  let before: Awaited<ReturnType<typeof profitAndLoss>>
  let beforePersian: Awaited<ReturnType<typeof profitAndLoss>>

  beforeAll(async () => {
    partner = await makeAdmin("Statement")
    session.admin.id = partner.id
    world = await makeWorld()
    before = await profitAndLoss({ ...YEAR, group: "quarter" })
    beforePersian = await profitAndLoss({ ...YEAR, group: "quarter" }, "persian")

    courseId = await makeCourse(world, partner.id, { endsAt: new Date("2003-08-01T12:00:00Z"), finalParticipants: 1 })
    const registrationId = await addRegistration(world, courseId)
    const common = { description: "x", createdBy: partner.id }
    await inTx(async (tx) => {
      await postRegistrationPayment(tx, { registrationId, occurredOn: "2003-02-10" })
      await postExpense(tx, { ...common, courseId, amount: 3000, occurredOn: "2003-05-05", source: "wallet" })
      general = await postExpense(tx, { ...common, amount: 1000, occurredOn: "2003-05-06", source: "wallet" })
      await postTransaction(tx, {
        ...common,
        kind: "course_settlement",
        occurredOn: "2003-08-01",
        courseId,
        lines: [
          { account: "instructor_fees", amount: 10000 },
          { account: "instructor_payable", amount: -10000 },
        ],
      })
      // A closing entry: moves the result to capital, never shows in profit and loss.
      await postTransaction(tx, {
        ...common,
        kind: "course_close",
        occurredOn: "2003-08-01",
        courseId,
        lines: [
          { account: "revenue", amount: 50000 },
          { account: "instructor_fees", amount: -10000 },
          { account: "course_expenses", amount: -3000 },
          { account: "partner_capital", partnerId: partner.id, amount: -37000 },
        ],
      })
      await postContribution(tx, { ...common, partnerId: partner.id, amount: 100000, occurredOn: "2003-01-05" })
      await postWithdrawal(tx, { ...common, description: "=cmd()", partnerId: partner.id, amount: 30000, occurredOn: "2003-03-01" })
      // As closing does: no projected fee any more, the settlement holds it.
      await tx.update(courses).set({ status: "closed", closedAt: new Date() }).where(eq(courses.id, courseId))
    })
  })

  afterAll(async () => {
    await retireAdmins([partner.id])
  })

  it("profit and loss by quarter, without closing entries", async () => {
    const after = await profitAndLoss({ ...YEAR, group: "quarter" })
    expect(after.periods.map((p) => p.period)).toEqual(["2003-01-01", "2003-04-01", "2003-07-01", "2003-10-01"])
    const delta = after.periods.map((p, i) => {
      const b = before.periods[i]
      return [p.revenue - b.revenue, p.instructorFees - b.instructorFees, p.courseExpenses - b.courseExpenses, p.generalExpenses - b.generalExpenses, p.net - b.net]
    })
    expect(delta).toEqual([
      [50000, 0, 0, 0, 50000],
      [0, 0, 3000, 1000, -4000],
      [0, 10000, 0, 0, -10000],
      [0, 0, 0, 0, 0],
    ])
    expect(after.total.net - before.total.net).toBe(36000)
  })

  it("profit and loss by Solar Hijri season for Persian", async () => {
    const after = await profitAndLoss({ ...YEAR, group: "quarter" }, "persian")
    // Winter 1381 (from 1 Dey, 22 Dec 2002), spring, summer, autumn and winter 1382 (Nowruz: 21 Mar 2003).
    expect(after.periods.map((p) => p.period)).toEqual(["2002-12-22", "2003-03-21", "2003-06-22", "2003-09-23", "2003-12-22"])
    const delta = after.periods.map((p, i) => {
      const b = beforePersian.periods[i]
      return [p.revenue - b.revenue, p.instructorFees - b.instructorFees, p.courseExpenses - b.courseExpenses, p.generalExpenses - b.generalExpenses, p.net - b.net]
    })
    // 10 Feb is in winter 1381; 5–6 May in spring 1382; 1 Aug in summer 1382.
    expect(delta).toEqual([
      [50000, 0, 0, 0, 50000],
      [0, 0, 3000, 1000, -4000],
      [0, 10000, 0, 0, -10000],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    expect(after.total.net - beforePersian.total.net).toBe(36000)
    const years = await profitAndLoss({ ...YEAR, group: "year" }, "persian")
    expect(years.periods.map((p) => p.period)).toEqual(["2002-03-21", "2003-03-21"])
    // Ordibehesht 1382 runs 21 Apr – 21 May 2003.
    const months = await profitAndLoss({ from: "2003-04-21", to: "2003-05-21", group: "month" }, "persian")
    expect(months.periods.map((p) => p.period)).toEqual(["2003-04-21"])
  })

  it("by workshop and by instructor", async () => {
    const { workshops } = await workshopResults(YEAR)
    expect(workshops.find((w) => w.id === courseId)).toMatchObject({
      revenue: 50000,
      instructorFees: 10000,
      estimatedFee: 0,
      courseExpenses: 3000,
      net: 37000,
      participants: 1,
    })
    const { instructors } = await instructorResults(YEAR)
    expect(instructors.find((i) => i.instructorId === world.instructorId)).toMatchObject({ workshops: 1, participants: 1, net: 37000 })
  })

  it("a partner statement with opening and closing balances", async () => {
    const reversal = await reverseTransaction(
      (await ledgerExport(YEAR, { kind: "capital_withdrawal", partner: partner.id }))[0].id,
      partner.id,
      { occurredOn: "2003-03-02" },
    )
    expect(reversal.original.kind).toBe("capital_withdrawal")
    const statement = (await partnerStatement(partner.id, { from: "2003-02-01", to: "2003-12-31" }))!
    expect(statement.opening).toBe(100000)
    expect(statement.movements.map((m) => [m.occurredOn, m.kind, m.originalKind, m.amount, m.balance])).toEqual([
      ["2003-03-01", "capital_withdrawal", null, -30000, 70000],
      ["2003-03-02", "reversal", "capital_withdrawal", 30000, 100000],
      ["2003-08-01", "course_close", null, 37000, 137000],
    ])
    expect(statement.closing).toBe(137000)
  })

  it("exports the ledger line by line with the page's filters", async () => {
    const lines = await ledgerExport(YEAR, { workshop: courseId })
    // Same day, same database transaction: the order between those entries is not defined.
    const sorted = (rows: (string | number)[][]) => rows.map((r) => r.join(" ")).sort()
    expect(sorted(lines.map((l) => [l.kind, l.account, l.amount]))).toEqual(sorted([
      ["registration_payment", "wallet", 50000],
      ["registration_payment", "revenue", -50000],
      ["expense", "course_expenses", 3000],
      ["expense", "wallet", -3000],
      ["course_settlement", "instructor_fees", 10000],
      ["course_settlement", "instructor_payable", -10000],
      ["course_close", "revenue", 50000],
      ["course_close", "instructor_fees", -10000],
      ["course_close", "course_expenses", -3000],
      ["course_close", "partner_capital", -37000],
    ]))
    expect(lines.map((l) => l.occurredOn)).toEqual([...lines.map((l) => l.occurredOn)].sort())
    // This test's general expense, its debit line first: the cost, then the wallet that paid it.
    const byAccount = (await ledgerExport(YEAR, { account: "general_expenses" })).filter((l) => l.id === general)
    expect(byAccount.map((l) => l.account)).toEqual(["general_expenses", "wallet"])
  })
})
