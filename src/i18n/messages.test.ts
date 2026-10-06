import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import { zodIssueMessage } from "@/lib/errors"
import { locales } from "./routing"

type Translate = (key: string, values?: Record<string, string | number>) => string

const load = async (locale: string) => ({
  common: (await import(`../../messages/${locale}/common.json`)).default,
  auth: (await import(`../../messages/${locale}/auth.json`)).default,
})

describe("numbers in shared messages", () => {
  it("are written with Persian digits in Persian", async () => {
    const t = createTranslator({ locale: "fa", messages: await load("fa") }) as unknown as Translate
    const common: Translate = (key, values) => t(`common.${key}`, values)
    const texts = [
      zodIssueMessage({ code: "too_small", origin: "string", minimum: 8, input: "abc" } as never, common),
      zodIssueMessage({ code: "too_big", origin: "string", maximum: 200, input: "x" } as never, common),
      zodIssueMessage({ code: "too_small", origin: "number", minimum: 5, input: 1 } as never, common),
      zodIssueMessage({ code: "too_big", origin: "number", maximum: 10_000, input: 1 } as never, common),
      t("common.form.languagesFilled", { count: 2, total: 3 }),
      t("auth.login.errors.invalid", { minutes: 15 }),
    ]
    for (const text of texts) {
      expect(text).toMatch(/[۰-۹]/)
      expect(text).not.toMatch(/[0-9]/)
    }
    expect(texts[4]).toBe("۲ از ۳ زبان")
  })

  it.each(locales)("format the same arguments in %s", async (locale) => {
    const t = createTranslator({ locale, messages: await load(locale) })
    expect(t("common.form.languagesFilled", { count: 2, total: 3 })).toMatch(/[2۲].*[3۳]/)
    expect(t("auth.login.errors.invalid", { minutes: 15 })).toMatch(/15|۱۵/)
  })
})
