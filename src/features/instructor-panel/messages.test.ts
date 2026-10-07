import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import { locales } from "@/i18n/routing"

const load = async (locale: string) => ({
  instructorPanel: (await import(`../../../messages/${locale}/instructorPanel.json`)).default as Record<string, unknown>,
})

const flat = (obj: object, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]))

/** Values for every placeholder the panel's messages use; numbers where they are formatted as numbers. */
const values = {
  brand: "Lart",
  email: "a@b.c",
  name: "Zeynep",
  title: "Seramik",
  count: 3,
  max: 8,
  min: 2,
  version: "2",
  date: "7 Oct 2026",
  photos: "2",
  videos: "1",
  total: "3",
  rate: "₺500",
  amount: "₺100",
  size: "15 MB",
  progress: 0.5,
  language: "Türkçe",
}

describe("instructor panel messages", () => {
  it("have the same keys in fa, tr and en", async () => {
    const [fa, tr, en] = await Promise.all(["fa", "tr", "en"].map(load))
    const keys = flat(en.instructorPanel).sort()
    expect(flat(fa.instructorPanel).sort()).toEqual(keys)
    expect(flat(tr.instructorPanel).sort()).toEqual(keys)
  })

  it.each(locales)("all format without errors in %s", async (locale) => {
    const messages = await load(locale)
    const t = createTranslator({ locale, messages, onError: (error) => { throw error } })
    for (const key of flat(messages.instructorPanel)) {
      const text = t(`instructorPanel.${key}` as never, values as never)
      expect(text, key).not.toMatch(/[{}]/)
      expect(text.trim(), key).not.toBe("")
    }
  })

  it.each(locales)("name the language of a contract signed in another one in %s", async (locale) => {
    const t = createTranslator({ locale, messages: await load(locale), onError: (error) => { throw error } })
    const text = t("instructorPanel.contract.signedNotice.otherLanguage" as never, { language: "\u2068English\u2069" } as never)
    expect(text).toContain("\u2068English\u2069")
  })

  it("write numbers with Persian digits in Persian", async () => {
    const t = createTranslator({ locale: "fa", messages: await load("fa") })
    for (const text of [
      t("instructorPanel.workshop.places" as never, { count: 6, max: 10 } as never),
      t("instructorPanel.nav.toSign" as never, { count: 2 } as never),
      t("instructorPanel.workshop.people.title" as never, { count: 12 } as never),
      t("instructorPanel.workshop.children" as never, { min: 7, max: 12 } as never),
    ]) {
      expect(text).toMatch(/[۰-۹]/)
      expect(text).not.toMatch(/[0-9]/)
    }
  })

  it("call a link «لینک» in Persian, as the emails do (not the formal «پیوند»)", async () => {
    expect(JSON.stringify((await load("fa")).instructorPanel)).not.toMatch(/پیوند/)
  })
})
