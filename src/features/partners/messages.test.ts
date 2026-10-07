import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import { locales } from "@/i18n/routing"
import { adminNotices, MAX_PARTNERS } from "./schema"

const load = async (locale: string) => ({
  partners: (await import(`../../../messages/${locale}/partners.json`)).default as Record<string, unknown>,
})

const flat = (obj: object, prefix = ""): [string, string][] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)] as [string, string]],
  )

/** Values for every placeholder the messages use; numbers where they are formatted as numbers. */
const values = { max: MAX_PARTNERS, invited: 0, name: "Leyla", email: "leyla@example.com", inviter: "Mina", brand: "Lart", min: 12, days: 7 }

describe("partners messages", () => {
  it("have the same keys in fa, tr and en", async () => {
    const [fa, tr, en] = await Promise.all(["fa", "tr", "en"].map(load))
    const keys = flat(tr.partners).map(([k]) => k).sort()
    expect(flat(fa.partners).map(([k]) => k).sort()).toEqual(keys)
    expect(flat(en.partners).map(([k]) => k).sort()).toEqual(keys)
  })

  it.each(locales)("all format without errors in %s", async (locale) => {
    const messages = await load(locale)
    const t = createTranslator({ locale, messages, onError: (error) => { throw error } })
    for (const [key] of flat(messages.partners)) {
      for (const invited of [0, 1, 2]) {
        expect(t(`partners.${key}` as never, { ...values, invited } as never), key).not.toMatch(/[{}]/)
      }
    }
  })

  it.each(locales)("ask to cancel an open invitation only when there is one (%s)", async (locale) => {
    const t = createTranslator({ locale, messages: await load(locale) })
    for (const key of ["partners.invite.full", "partners.errors.limit"]) {
      // The team is full without invitations: there is nothing to cancel.
      const full = t(key as never, { max: MAX_PARTNERS, invited: 0 } as never)
      const open = t(key as never, { max: MAX_PARTNERS, invited: 1 } as never)
      expect(full, key).not.toBe(open)
      expect(open, key).toBe(t(key as never, { max: MAX_PARTNERS, invited: 2 } as never))
      const cancel = { fa: "لغو کنید", tr: "iptal edin", en: "cancel" }[locale]
      expect(open, key).toContain(cancel)
      expect(full, key).not.toContain(cancel)
    }
  })

  it("write numbers with Persian digits in Persian", async () => {
    const t = createTranslator({ locale: "fa", messages: await load("fa") })
    for (const key of ["partners.invite.full", "partners.errors.limit", "partners.accept.errors.limit"]) {
      for (const invited of [0, 1]) {
        const text = t(key as never, { max: MAX_PARTNERS, invited } as never)
        expect(text, key).toMatch(/[۰-۹]/)
        expect(text, key).not.toMatch(/[0-9]/)
      }
    }
  })

  it("call a link «لینک» in Persian (not the formal «پیوند»)", async () => {
    expect(JSON.stringify((await load("fa")).partners)).not.toMatch(/پیوند/)
  })

  it("have a text for every notice an action can leave", async () => {
    for (const locale of locales) {
      const notices = (await load(locale)).partners.notices as Record<string, string>
      for (const notice of adminNotices) expect(notices[notice], `${locale} ${notice}`).toBeTruthy()
    }
  })
})
