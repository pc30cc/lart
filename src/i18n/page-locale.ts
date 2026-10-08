import "server-only"
import { notFound } from "next/navigation"

import { isAppLocale, type AppLocale } from "./locales"

/**
 * A public page's `[locale]`, checked: anything else is the not-found page.
 * The language layout refuses an unknown language too, but a page's metadata
 * and body run beside it, and an address with a dot skips the proxy
 * (/wp-login.php arrives as the language "wp-login.php"): without this they
 * would query and build a page, canonical links included, for it.
 */
export function pageLocale(locale: string): AppLocale {
  if (!isAppLocale(locale)) notFound()
  return locale
}
