import { defineRouting } from "next-intl/routing"

import { FALLBACK_LOCALE, locales, type AppLocale } from "./locales"

export * from "./locales"

/**
 * The main language (a setting, src/i18n/main-locale.ts) has no prefix, the
 * others do ("as-needed"). Nothing is guessed from the browser: no
 * Accept-Language, no NEXT_LOCALE cookie (the address says the language), and
 * hreflang comes from the pages' metadata, not a `Link` header.
 */
const shared = {
  locales,
  localePrefix: "as-needed",
  localeDetection: false,
  localeCookie: false,
  alternateLinks: false,
} as const

/** For the request config and `hasLocale`; its `defaultLocale` is only the fallback. */
export const routing = defineRouting({ ...shared, defaultLocale: FALLBACK_LOCALE })

/** The routing of the proxy's next-intl middleware for the current main language. */
export const routingFor = (main: AppLocale) => defineRouting({ ...shared, defaultLocale: main })
