import "server-only"

import { mainLocale } from "@/i18n/links"
import { localePath } from "@/i18n/paths"
import { locales } from "@/i18n/routing"
import { env } from "@/lib/env"

/** An absolute link on the site (canonical URLs, Open Graph, JSON-LD, sitemap). */
export const absoluteUrl = (path: string) => new URL(path, env.APP_URL).href

/** Open Graph locale of each language (the site's English is British). */
export const ogLocale: Record<string, string> = { fa: "fa_IR", tr: "tr_TR", en: "en_GB" }

/** The site's share picture (src/app/og.png: its logo), for pages without one of their own. */
export const siteOgImage = () => ({ url: absoluteUrl("/og.png"), width: 1200, height: 630 })

/**
 * The Open Graph fields every public page has: its address, its language and
 * the other languages it exists in, and a picture (the site's when `images`
 * is empty). A page's `openGraph` replaces its layout's whole, so each page
 * spreads these into its own.
 */
export function openGraphOf(locale: string, url: string, images?: { url: string; alt?: string; width?: number; height?: number }[]) {
  return {
    url,
    locale: ogLocale[locale],
    alternateLocale: locales.filter((l) => l !== locale).map((l) => ogLocale[l]),
    images: images?.length ? images : [siteOgImage()],
  }
}

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
