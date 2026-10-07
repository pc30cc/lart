import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { parseTableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { postAdvance, postContribution, postExpense, reverseTransaction } from "./ledger"
import {
  getLedgerFilterOptions,
  getWalletOverview,
  getWorkshopFinances,
  isReversible,
  listPartnerAccounts,
  listTransactions,
} from "./queries"
import { transactionTable } from "./schema"
import { makeAdmin, makeCourse, makeWorld, retireAdmins } from "./testing"

const session = vi.hoisted(() => ({ sessionId: "test", admin: { id: "", email: "", name: "Queries", shareBp: 0 } }))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

let partner: { id: string; name: string }
let courseId: string
const ids: Record<string, string> = {}
const day = "2005-03-04"
const tag = randomUUID().slice(0, 8)

beforeAll(async () => {
  partner = await makeAdmin("Queries Partner")
  session.admin.id = partner.id
  const world = await makeWorld()
  courseId = await makeCourse(world, partner.id, { status: "published", fee: { type: "fixed", amount: 9000, advance: 3000 } })
  const common = { occurredOn: day, createdBy: partner.id }
  await db.transaction(async (tx) => {
    ids.contribution = await postContribution(tx, { ...common, description: "seed money", partnerId: partner.id, amount: 50000 })
    ids.expense = await postExpense(tx, { ...common, description: `Kil ve sır ${tag}`, courseId, amount: 2500, source: { partnerId: partner.id } })
    ids.advance = await postAdvance(tx, { ...common, description: "", courseId, amount: 3000, direction: "paid", source: "wallet" })
  })
  ids.reversal = (await reverseTransaction(ids.expense, partner.id, { occurredOn: day })).id
})

afterAll(async () => {
  await retireAdmins([partner.id])
})

const params = (sp: Record<string, string>) =>
  parseTableParams(sp, {
    sort: transactionTable.sort,
    defaultSort: "occurredOn",
    defaultDir: "desc",
    filters: { ...transactionTable.filters, partner: [partner.id], workshop: [courseId] },
  })

describe("money queries", () => {
  it("lists the ledger with filters, lines and reversal links", async () => {
    const { rows, total } = await listTransactions(params({ partner: partner.id }), { from: day, to: day })
    expect(total).toBe(3) // contribution, expense and its correction
    const expense = rows.find((r) => r.id === ids.expense)!
    expect(expense).toMatchObject({ kind: "expense", description: `Kil ve sır ${tag}`, reversedBy: ids.reversal, amount: 2500, walletChange: 0 })
    expect(expense.lines.map((l) => [l.account, l.partnerName, l.amount])).toEqual([
      ["course_expenses", null, 2500],
      ["partner_capital", "Queries Partner", -2500],
    ])
    expect(isReversible(expense)).toBe(false)
    const correction = rows.find((r) => r.id === ids.reversal)!
    expect(correction).toMatchObject({ kind: "reversal", originalKind: "expense", reversalOf: ids.expense })
    expect(isReversible(correction)).toBe(false)
    expect(isReversible(rows.find((r) => r.id === ids.contribution)!)).toBe(true)
    // A cancelled workshop stays "cancelled" once its books are closed: closed_at locks it.
    const locked = { reversedBy: null, courseStatus: "cancelled" as const, courseClosedAt: new Date() }
    expect(isReversible({ ...locked, kind: "expense" })).toBe(false)
    expect(isReversible({ ...locked, kind: "instructor_payment" })).toBe(true)
    expect(isReversible({ ...locked, kind: "expense", courseClosedAt: null })).toBe(true)
    // A registration's payment or refund: undone by cancelling the registration, even while the books are open.
    expect(isReversible({ ...locked, kind: "registration_payment", courseClosedAt: null })).toBe(false)
    expect(isReversible({ ...locked, kind: "registration_refund", courseClosedAt: null })).toBe(false)

    const search = await listTransactions(params({ q: `KIL VE sır ${tag}` }), { from: day, to: day })
    expect(search.rows.map((r) => r.id).sort()).toEqual([ids.expense, ids.reversal].sort())
    const byAccount = await listTransactions(params({ account: "instructor_advance", workshop: courseId }), {})
    expect(byAccount.rows.map((r) => r.id)).toEqual([ids.advance])
    expect(byAccount.rows[0].walletChange).toBe(-3000)
    const sorted = await listTransactions(params({ workshop: courseId, sort: "amount", dir: "asc" }), {})
    expect(sorted.rows.map((r) => r.amount)).toEqual([2500, 2500, 3000])
  })

  it("gives a workshop's finances with its entries described", async () => {
    const f = (await getWorkshopFinances(courseId))!
    expect(f.status).toBe("published")
    expect(f.issues).toContain("notClosable")
    expect(f.balances).toMatchObject({ advance: 3000, courseExpenses: 0 })
    expect(f.contract).toMatchObject({ feeType: "fixed", feeAmount: 9000, advanceAmount: 3000 })
    const expense = f.entries.find((e) => e.id === ids.expense)!
    expect(expense).toMatchObject({ amount: 2500, source: { type: "partner", name: "Queries Partner" } })
    expect(f.entries.find((e) => e.id === ids.advance)).toMatchObject({ direction: "paid", source: { type: "wallet" }, amount: 3000 })
    expect(f.entries.some((e) => e.kind === "reversal")).toBe(false)
    expect(await getWorkshopFinances("00000000-0000-4000-8000-000000000000")).toBeNull()
  })

  it("summarises the wallet, the partners and the filter choices", async () => {
    const overview = await getWalletOverview()
    expect(overview.recent.length).toBeGreaterThan(0)
    expect(overview.withInstructors.find((r) => r.courseId === courseId)).toMatchObject({ advance: 3000, owed: 0 })
    const { rows } = await listPartnerAccounts()
    expect(rows.find((r) => r.id === partner.id)).toMatchObject({ contributions: 50000, paidForBusiness: 0, capital: 50000 })
    const options = await getLedgerFilterOptions()
    expect(options.partners.some((p) => p.id === partner.id)).toBe(true)
    expect(options.workshops.some((w) => w.id === courseId)).toBe(true)
  })
})
