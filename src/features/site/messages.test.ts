import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import { locales } from "@/i18n/routing"

/** The Home page editor's texts, and the Appearance and General settings that name the site's template. */
const load = async (locale: string) => ({
  homeEditor: (await import(`../../../messages/${locale}/homeEditor.json`)).default as Record<string, unknown>,
  appearance: (await import(`../../../messages/${locale}/appearance.json`)).default as Record<string, unknown>,
  settings: (await import(`../../../messages/${locale}/settings.json`)).default as Record<string, unknown>,
})

const flat = (obj: object, prefix = ""): [string, string][] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)] as [string, string]],
  )

/** Values for every placeholder the messages use; numbers where they are formatted as numbers. */
const values = { max: 6, min: 5, n: 2 }

/**
 * The word for the site's look in each language (Settings → Appearance), and
 * the other word it must not be called by: the Home page editor's "Choose a
 * template" button opens that page.
 */
const word: Record<string, { is: RegExp; not: RegExp }> = {
  fa: { is: /قالب/, not: /پوسته/ },
  tr: { is: /tema/i, not: /şablon/i },
  en: { is: /template/i, not: /theme/i },
}

describe("home page editor messages", () => {
  it("have the same keys in fa, tr and en", async () => {
    const [fa, tr, en] = await Promise.all(["fa", "tr", "en"].map(load))
    const keys = flat(tr.homeEditor).map(([k]) => k).sort()
    expect(flat(fa.homeEditor).map(([k]) => k).sort()).toEqual(keys)
    expect(flat(en.homeEditor).map(([k]) => k).sort()).toEqual(keys)
  })

  it.each(locales)("all format without errors in %s", async (locale) => {
    const messages = await load(locale)
    const t = createTranslator({ locale, messages, onError: (error) => { throw error } })
    for (const [key] of flat(messages.homeEditor)) {
      expect(t(`homeEditor.${key}` as never, values as never), key).not.toMatch(/[{}]/)
    }
  })

  it.each(locales)("call the site's look by the Appearance page's word in %s", async (locale) => {
    const { homeEditor, appearance } = await load(locale)
    const t = createTranslator({ locale, messages: { homeEditor, appearance } })
    expect(t("appearance.theme.label" as never)).toMatch(word[locale].is)
    expect(t("homeEditor.chooseTheme" as never)).toMatch(word[locale].is)
    for (const [key, text] of flat(homeEditor)) expect(text, key).not.toMatch(word[locale].not)
  })

  it("use the site's Persian words (ورکشاپ, لینک)", async () => {
    const text = JSON.stringify((await load("fa")).homeEditor)
    expect(text).not.toMatch(/کارگاه|پیوند/)
  })
})

describe("the SEO description's hint (Settings → General)", () => {
  // Only the Classic template shows the SEO description under the brand on the home page.
  it.each(locales)("ties the sentence under the brand to the Classic template in %s", async (locale) => {
    const messages = await load(locale)
    const t = createTranslator({ locale, messages })
    const hint = t("settings.general.seoPageDescriptionHint" as never)
    expect(hint).toContain(t("appearance.theme.names.default" as never))
    expect(hint).toMatch(word[locale].is)
  })
})
