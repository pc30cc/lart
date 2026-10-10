import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import en from "../../../messages/en/money.json"
import fa from "../../../messages/fa/money.json"
import tr from "../../../messages/tr/money.json"
import { accounts, periodGroups, reportKinds, transactionKinds } from "./schema"

const all = { en, fa, tr }
type Tree = { [key: string]: string | Tree }

function keys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)))
}

const values = { name: "Ayşe", participant: "Deniz", paid: "₺1.500", refund: "₺750", amount: "₺1.250", count: 3, date: "1 Oct", kind: "Expense", title: "Candles", what: "Clay", total: "100%", rest: "10%", advance: "₺500", owed: "₺700", quarter: "1", season: "spring", year: "2026", from: "1", to: "20", pending: 2, max: 10 }

describe("money messages", () => {
  it("have the same keys in fa, tr and en", () => {
    const expected = keys(en).sort()
    expect(keys(fa).sort()).toEqual(expected)
    expect(keys(tr).sort()).toEqual(expected)
  })

  it("cover every kind, account, report, grouping and closing issue", () => {
    for (const k of transactionKinds) expect(en.kinds).toHaveProperty(k)
    for (const a of accounts) expect(en.accounts).toHaveProperty(a)
    for (const r of reportKinds) expect(en.reports.tabs).toHaveProperty(r)
    for (const g of periodGroups) expect(en.reports.groups).toHaveProperty(g)
    for (const i of ["closed", "notClosable", "notEnded", "noContract", "refundsOwed", "unpaidRegistrations", "revenueMismatch", "advanceTooBig", "sharesNot100"]) {
      expect(en.close.issues).toHaveProperty(i)
    }
  })

  it.each(Object.entries(all))("are valid ICU messages in %s", (locale, messages) => {
    const errors: string[] = []
    const t = createTranslator({ locale, messages: { money: messages }, onError: (e) => errors.push(e.message) }) as unknown as (
      key: string,
      values: Record<string, string | number>,
    ) => string
    for (const key of keys(messages as Tree)) t(`money.${key}`, values)
    expect(errors).toEqual([])
  })
})
