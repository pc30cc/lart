import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import { locales } from "@/i18n/routing"
import { siteNotices } from "./schema"

/** The namespaces of the accounts module (the site shell, the account pages, the sign-in pages). */
const NAMESPACES = ["site", "account", "auth"] as const

const load = async (locale: string) =>
  Object.fromEntries(
    await Promise.all(NAMESPACES.map(async (ns) => [ns, (await import(`../../../messages/${locale}/${ns}.json`)).default])),
  ) as Record<(typeof NAMESPACES)[number], Record<string, unknown>>

const flat = (obj: object, prefix = ""): [string, string][] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)] as [string, string]],
  )

/** Values for every placeholder the messages use; numbers where they are formatted as numbers. */
const values = { brand: "Lart", email: "a@b.c", name: "Ayşe", min: 10, minutes: 30, days: 7, year: "2026" }

describe("accounts messages", () => {
  it("have the same keys in fa, tr and en", async () => {
    const [fa, tr, en] = await Promise.all(["fa", "tr", "en"].map(load))
    for (const ns of NAMESPACES) {
      const keys = flat(tr[ns]).map(([k]) => k).sort()
      expect(flat(fa[ns]).map(([k]) => k).sort(), ns).toEqual(keys)
      expect(flat(en[ns]).map(([k]) => k).sort(), ns).toEqual(keys)
    }
  })

  it.each(locales)("all format without errors in %s", async (locale) => {
    const messages = await load(locale)
    const t = createTranslator({ locale, messages, onError: (error) => { throw error } })
    for (const ns of NAMESPACES) {
      for (const [key] of flat(messages[ns])) {
        const text = t(`${ns}.${key}` as never, values as never)
        expect(text, `${ns}.${key}`).not.toMatch(/[{}]/)
      }
    }
  })

  it("write numbers with Persian digits in Persian", async () => {
    const t = createTranslator({ locale: "fa", messages: await load("fa") })
    for (const text of [
      t("account.form.newPasswordHint" as never, { min: 10 } as never),
      t("account.login.errors.invalid" as never, { minutes: 15 } as never),
      t("auth.instructor.invite.invalid" as never, { days: 7, brand: "لارت" } as never),
    ]) {
      expect(text).toMatch(/[۰-۹]/)
      expect(text).not.toMatch(/[0-9]/)
    }
  })

  it("have a text for every notice an action can leave", async () => {
    for (const locale of locales) {
      const { site } = await load(locale)
      for (const notice of siteNotices) expect((site.notices as Record<string, string>)[notice], `${locale} ${notice}`).toBeTruthy()
    }
  })
})
