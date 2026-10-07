import type { MetadataRoute } from "next"
import { connection } from "next/server"

import { absoluteUrl } from "@/app/[locale]/(site)/workshops/_components/seo"
import { locales } from "@/i18n/routing"

/**
 * /robots.txt: the public site is open to crawlers; the super-admin panel,
 * the instructor panel, the member's account pages (`/<locale>/admin`, …, one
 * line per language rather than a wildcard over the language, which would also
 * hide a workshop whose address starts with "admin") and the APIs are not (they also
 * answer `X-Robots-Tag: noindex`, src/proxy.ts). Built per request so the
 * sitemap link uses the running site's APP_URL.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection()
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...locales.flatMap((l) => [`/${l}/admin`, `/${l}/instructor`, `/${l}/account`]), "/api"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  }
}
