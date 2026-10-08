import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import { locales } from "@/i18n/routing"
import { fonts } from "./fonts"
import { themeIds } from "./ids"

/** The Appearance settings page's texts (messages/<locale>/appearance.json). */
const load = async (locale: string) => ({
  appearance: (await import(`../../messages/${locale}/appearance.json`)).default as Record<string, unknown>,
})

const flat = (obj: object, prefix = ""): [string, string][] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)] as [string, string]],
  )

/** Values for every placeholder the messages use; numbers where they are formatted as numbers. */
const values = { theme: "Atelier", name: "Bold", n: 700 }

describe("appearance messages", () => {
  it("have the same keys in fa, tr and en", async () => {
    const [fa, tr, en] = await Promise.all(["fa", "tr", "en"].map(load))
    const keys = flat(tr.appearance).map(([k]) => k).sort()
    expect(flat(fa.appearance).map(([k]) => k).sort()).toEqual(keys)
    expect(flat(en.appearance).map(([k]) => k).sort()).toEqual(keys)
  })

  it.each(locales)("all format without errors in %s", async (locale) => {
    const messages = await load(locale)
    const t = createTranslator({ locale, messages, onError: (error) => { throw error } })
    for (const [key] of flat(messages.appearance)) {
      expect(t(`appearance.${key}` as never, values as never), key).not.toMatch(/[{}]/)
    }
  })

  it.each(locales)("name and describe every theme and every weight of the registry in %s", async (locale) => {
    const t = createTranslator({ locale, messages: await load(locale), onError: (error) => { throw error } })
    for (const id of themeIds) {
      expect(t(`appearance.theme.names.${id}` as never)).toBeTruthy()
      expect(t(`appearance.theme.descriptions.${id}` as never)).toBeTruthy()
    }
    for (const weight of new Set(fonts.flatMap((f) => f.weights))) expect(t(`appearance.fonts.weights.${weight}` as never)).toBeTruthy()
  })

  it("write weights with Persian digits in Persian", async () => {
    const t = createTranslator({ locale: "fa", messages: await load("fa") })
    expect(t("appearance.fonts.weightName" as never, { name: "پررنگ", n: 700 } as never)).toBe("پررنگ ۷۰۰")
  })

  it("use the site's Persian words (ورکشاپ, لینک)", async () => {
    const text = JSON.stringify((await load("fa")).appearance)
    expect(text).not.toMatch(/کارگاه|پیوند/)
  })
})
