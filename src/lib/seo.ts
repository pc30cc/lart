import "server-only"

import { mainLocale } from "@/i18n/links"
import { localePath } from "@/i18n/paths"
import { locales } from "@/i18n/routing"
import { env } from "@/lib/env"

/** An absolute link on the site (canonical URLs, Open Graph, JSON-LD, sitemap). */
export const absoluteUrl = (path: string) => new URL(path, env.APP_URL).href

/** Open Graph locale of each language. */
export const ogLocale: Record<string, string> = { fa: "fa_IR", tr: "tr_TR", en: "en_US" }

/**
 * Canonical URL and hreflang alternates of a page that exists in every
 * language: `path` without the language, e.g. "/workshops/candle-making".
 * The main language's address has no prefix, and it is the x-default too.
 */
export async function alternates(path: string, locale: string) {
  const main = await mainLocale()
  return {
    canonical: absoluteUrl(localePath(locale, path, main)),
    languages: {
      ...Object.fromEntries(locales.map((l) => [l, absoluteUrl(localePath(l, path, main))])),
      "x-default": absoluteUrl(localePath(main, path, main)),
    },
  }
}

/** A JSON-LD object as the text of a <script> tag, with "<" escaped (no way to close the tag). */
export const jsonLdText = (data: object) => JSON.stringify(data).replace(/</g, "\\u003c")
