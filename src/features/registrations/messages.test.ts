import { readFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import { locales } from "@/i18n/routing"
import { isMessageKey } from "@/lib/errors"
import en from "../../../messages/en/registration.json"
import fa from "../../../messages/fa/registration.json"
import tr from "../../../messages/tr/registration.json"

const all = { fa, tr, en } as const

const flat = (obj: object, prefix = ""): [string, string][] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)] as [string, string]],
  )

/** Values for every placeholder the messages use; numbers where they are formatted as numbers. */
const values = {
  brand: "Lart",
  name: "Ayşe",
  email: "a@b.c",
  amount: "₺1.500",
  paid: "₺1.500",
  refund: "₺750",
  title: "Mum Yapımı",
  date: "14 Ekim 2026",
  venue: "Moda",
  count: 2,
  min: 7,
  max: 12,
  n: 3,
  percent: 50,
}

describe("registration messages", () => {
  it("have the same keys in fa, tr and en", () => {
    const keys = flat(tr).map(([k]) => k).sort()
    expect(flat(fa).map(([k]) => k).sort()).toEqual(keys)
    expect(flat(en).map(([k]) => k).sort()).toEqual(keys)
  })

  it.each(locales)("all format without errors in %s", (locale) => {
    const t = createTranslator({ locale, messages: { registration: all[locale] }, onError: (error) => { throw error } })
    for (const [key] of flat(all[locale])) {
      const text = t(`registration.${key}` as never, values as never)
      expect(text, key).not.toMatch(/[{}]/)
    }
  })

  it("write numbers with Persian digits in Persian", () => {
    const t = createTranslator({ locale: "fa", messages: { registration: fa } })
    for (const text of [
      t("registration.seats.left", { count: 3 }),
      t("registration.age.children", { min: 7, max: 12 }),
      t("registration.errors.tooMany", { max: 5 }),
      t("registration.cancel.partial", { percent: 50, refund: "" }),
    ]) {
      expect(text).toMatch(/[۰-۹]/)
      expect(text).not.toMatch(/[0-9]/)
    }
  })

  it("use «ورکشاپ» for workshop in Persian", () => {
    expect(JSON.stringify(fa)).toContain("ورکشاپ")
    expect(JSON.stringify(fa)).not.toMatch(/کارگاه/)
  })

  it("call a link «لینک» in Persian, as the emails do (not the formal «پیوند»)", () => {
    expect(JSON.stringify(fa)).not.toMatch(/پیوند/)
  })

  it("cover every message key the module's code uses", () => {
    const files = [
      "register.ts",
      "schema.ts",
      "components/register-form.tsx",
      "components/payment-instructions.tsx",
      "components/cancel-registration.tsx",
    ]
    const used = files.flatMap((file) =>
      Array.from(readFileSync(new URL(`./${file}`, import.meta.url), "utf8").matchAll(/"(registration\.[a-zA-Z.]+)"/g), (m) => m[1]),
    )
    expect(used.length).toBeGreaterThan(5)
    const keys = new Set(flat(tr).map(([k]) => `registration.${k}`))
    for (const key of used.filter(isMessageKey)) {
      // A namespace prefix (useTranslations("registration.payment")) is fine too.
      expect(keys.has(key) || [...keys].some((k) => k.startsWith(`${key}.`)), key).toBe(true)
    }
  })
})
