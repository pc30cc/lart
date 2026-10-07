import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import { locales } from "@/i18n/routing"

/**
 * The texts of the Students area and of "account access" (set a password,
 * enter their panel), the "viewing as" bar and the refusal while viewing.
 */
const load = async (locale: string) => ({
  students: (await import(`../../../messages/${locale}/students.json`)).default as Record<string, unknown>,
  admin: (await import(`../../../messages/${locale}/admin.json`)).default as Record<string, Record<string, unknown>>,
  common: (await import(`../../../messages/${locale}/common.json`)).default as Record<string, Record<string, unknown>>,
})

/** The parts checked here: [namespace, key prefix]. */
const parts = [
  ["students", ""],
  ["admin", "access."],
  ["admin", "nav."],
  ["common", "impersonation."],
  ["common", "errors."],
] as const

const flat = (obj: object, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]))

const keysOf = (messages: Awaited<ReturnType<typeof load>>) =>
  parts.flatMap(([ns, prefix]) => {
    const root = prefix ? (messages[ns] as Record<string, object>)[prefix.slice(0, -1)] : messages[ns]
    return flat(root, `${ns}.${prefix}`)
  })

/** Values for every placeholder these messages use; numbers where they are formatted as numbers. */
const values = { name: "Ayşe", admin: "Mina", min: 10, time: "7 Oct 2026, 14:00", count: 3 }

describe("students and account access messages", () => {
  it("have the same keys in fa, tr and en", async () => {
    const [fa, tr, en] = await Promise.all(["fa", "tr", "en"].map(load))
    const keys = keysOf(en).sort()
    expect(keys).toContain("admin.access.password.result.once")
    expect(keysOf(fa).sort()).toEqual(keys)
    expect(keysOf(tr).sort()).toEqual(keys)
  })

  it.each(locales)("all format without errors in %s", async (locale) => {
    const messages = await load(locale)
    const t = createTranslator({ locale, messages, onError: (error) => { throw error } })
    for (const key of keysOf(messages)) {
      const text = t(key as never, values as never)
      expect(text, key).not.toMatch(/[{}]/)
      expect(text.trim(), key).not.toBe("")
    }
  })

  it("write the password length with Persian digits in Persian, and keep the names in the bar", async () => {
    const t = createTranslator({ locale: "fa", messages: await load("fa") })
    expect(t("admin.access.password.hint" as never, { min: 10 } as never)).toContain("۱۰")
    expect(t("students.detail.registrations.count" as never, { count: 3 } as never)).toContain("۳")
    for (const locale of locales) {
      const tl = createTranslator({ locale, messages: await load(locale) })
      const bar = tl("common.impersonation.text" as never, { name: "⁨Ayşe⁩", admin: "⁨Mina⁩" } as never)
      expect(bar).toContain("⁨Ayşe⁩")
      expect(bar).toContain("⁨Mina⁩")
    }
  })

  it("use the site's Persian words: «لینک», «ورکشاپ»", async () => {
    const messages = await load("fa")
    const t = createTranslator({ locale: "fa", messages })
    for (const key of keysOf(messages)) {
      const text = t(key as never, values as never)
      expect(text, key).not.toContain("پیوند")
      expect(text, key).not.toContain("کارگاه")
    }
  })
})
