import "server-only"

import { locales } from "@/i18n/routing"
import { env } from "@/lib/env"
import { getSetting } from "@/lib/settings"

/** An absolute link on the site (canonical URLs, Open Graph, JSON-LD). */
export const absoluteUrl = (path: string) => new URL(path, env.APP_URL).href

/** Open Graph locale of each language. */
export const ogLocale: Record<string, string> = { fa: "fa_IR", tr: "tr_TR", en: "en_US" }

/**
 * Canonical URL and hreflang alternates of a page that exists in every
 * language: `path` without the language, e.g. "/workshops/candle-making".
 * x-default is the site's default language (a setting).
 */
export async function alternates(path: string, locale: string) {
  const defaultLocale = await getSetting("defaultLocale")
  return {
    canonical: absoluteUrl(`/${locale}${path}`),
    languages: {
      ...Object.fromEntries(locales.map((l) => [l, absoluteUrl(`/${l}${path}`)])),
      "x-default": absoluteUrl(`/${defaultLocale}${path}`),
    },
  }
}

/** A JSON-LD object as the text of a <script> tag, with "<" escaped (no way to close the tag). */
export const jsonLdText = (data: object) => JSON.stringify(data).replace(/</g, "\\u003c")
