import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import en from "../../../messages/en/dashboard.json"
import fa from "../../../messages/fa/dashboard.json"
import tr from "../../../messages/tr/dashboard.json"

const all = { en, fa, tr }
type Tree = { [key: string]: string | Tree }

function keys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)))
}

const values = { name: "Ayşe", date: "6 Oct", count: 3, done: "1", total: "5", amount: "₺1.250", year: "2026", taken: "8", seats: "12", max: "12", share: "60%", when: "8 Oct, 12:00" }

function translator(locale: string, messages: unknown, errors: string[]) {
  return createTranslator({ locale, messages: { dashboard: messages }, onError: (e) => errors.push(e.message) }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string
}

describe("dashboard messages", () => {
  it("have the same keys in fa, tr and en", () => {
    const expected = keys(en).sort()
    expect(keys(fa).sort()).toEqual(expected)
    expect(keys(tr).sort()).toEqual(expected)
  })

  it("cover the keys built at runtime", () => {
    for (const part of ["morning", "afternoon", "evening"]) expect(en.greeting).toHaveProperty(part)
    for (const step of ["category", "instructor", "contract", "workshop", "capital"]) {
      for (const field of ["title", "description", "action"]) expect(en.setup.steps).toHaveProperty(`${step}.${field}`)
    }
    for (const item of ["decisions", "signatures", "toClose"]) expect(en.attention).toHaveProperty(item)
  })

  it.each(Object.entries(all))("are valid ICU messages in %s", (locale, messages) => {
    const errors: string[] = []
    const t = translator(locale, messages, errors)
    for (const key of keys(messages as Tree)) t(`dashboard.${key}`, values)
    expect(errors).toEqual([])
  })

  it("writes counts with Persian digits in Persian", () => {
    const t = translator("fa", fa, [])
    expect(t("dashboard.profit.workshops", { count: 12 })).toBe("۱۲ کارگاه")
    expect(t("dashboard.attention.signatures", { count: 2 })).toContain("۲")
    expect(translator("tr", tr, [])("dashboard.profit.workshops", { count: 12 })).toBe("12 atölye")
  })
})
