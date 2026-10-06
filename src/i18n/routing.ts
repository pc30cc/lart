import { defineRouting } from "next-intl/routing"

export const locales = ["fa", "tr", "en"] as const
export type AppLocale = (typeof locales)[number]
export const rtlLocales: readonly AppLocale[] = ["fa"]
export const isRtl = (locale: string) => (rtlLocales as readonly string[]).includes(locale)

export const routing = defineRouting({
  locales,
  // Fallback only. The site's real default language is a super-admin setting,
  // applied by the root page (src/app/page.tsx).
  defaultLocale: "tr",
  localePrefix: "always",
})
