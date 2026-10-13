import { describe, expect, it } from "vitest"

import { emailTemplateNames } from "./names"

const locales = ["fa", "tr", "en"] as const

describe("email template names", () => {
  it.each(locales)("every email has its title, who gets it and a subject in %s (never a raw key on the templates page)", async (locale) => {
    const templates = (await import(`../../messages/${locale}/templates.json`)).default.emails.names
    const emails = (await import(`../../messages/${locale}/emails.json`)).default
    for (const name of emailTemplateNames) {
      expect(templates[name]?.title, `${locale} templates.emails.names.${name}.title`).toEqual(expect.any(String))
      expect(templates[name]?.to, `${locale} templates.emails.names.${name}.to`).toEqual(expect.any(String))
      expect(emails[name]?.subject, `${locale} emails.${name}.subject`).toEqual(expect.any(String))
    }
  })
})
