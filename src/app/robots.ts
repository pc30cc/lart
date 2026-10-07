import type { MetadataRoute } from "next"
import { connection } from "next/server"

import { locales } from "@/i18n/routing"
import { absoluteUrl } from "@/lib/seo"

/**
 * /robots.txt: the public site is open to crawlers; the super-admin panel
 * (`/admin` in the main language and `/<locale>/admin` in each language, one
 * line each rather than a wildcard over the language, which would also hide a
 * workshop whose address starts with "admin"; no public route starts with
 * "admin", see the guard test in lib/routes.test.ts) and the APIs are not.
 * The instructor panel and the member's account pages are left crawlable on
 * purpose: a Disallow would stop crawlers from fetching them, so they would
 * never see the `X-Robots-Tag: noindex` (src/proxy.ts) and the meta noindex,
 * and a leaked link could still be indexed as a bare URL; it would also
 * publish the instructor panel's private address (README §5). Built per
 * request so the sitemap link uses the running site's APP_URL.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection()
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", ...locales.map((l) => `/${l}/admin`), "/api"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  }
}
