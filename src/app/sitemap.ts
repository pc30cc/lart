import type { MetadataRoute } from "next"
import { connection } from "next/server"

import { sitemapWorkshops } from "@/features/registrations/public"
import { aboutHasPartners } from "@/features/site/about"
import { getMainLocale } from "@/i18n/main-locale"
import { localePath } from "@/i18n/paths"
import { locales } from "@/i18n/routing"
import { absoluteUrl } from "@/lib/seo"

/**
 * /sitemap.xml: the home page, the workshops list, every open workshop page
 * and the About page (while a partner is on it; else it is not indexed), in
 * each language, each with its hreflang alternates (fa, tr, en, and
 * x-default: the main language), as the pages' own metadata gives them. The
 * main language's addresses have no prefix (docs/DEVELOPMENT.md, "URL
 * rules"). Built on each request, so a workshop appears as soon as it is
 * published. Private areas (admin, instructor, account) are never listed,
 * nor the list's craft views (/workshops?category=…: noindex, follow, with
 * no canonical or language links).
 * The proxy does not run here (a file extension): the main language is read
 * directly, never from a request header.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection()
  const [workshops, main, about] = await Promise.all([sitemapWorkshops(), getMainLocale(), aboutHasPartners()])
  const latest = workshops.reduce<Date | undefined>((a, w) => (!a || w.updatedAt > a ? w.updatedAt : a), undefined)
  const pages = [
    { path: "/", lastModified: latest, priority: 1 },
    { path: "/workshops", lastModified: latest, priority: 0.9 },
    ...workshops.map((w) => ({ path: `/workshops/${w.slug}`, lastModified: w.updatedAt, priority: 0.8 })),
    ...(about ? [{ path: "/about", lastModified: undefined, priority: 0.6 }] : []),
  ]
  const url = (locale: string, path: string) => absoluteUrl(localePath(locale, path, main))
  return pages.flatMap(({ path, lastModified, priority }) => {
    const languages = {
      ...Object.fromEntries(locales.map((l) => [l, url(l, path)])),
      "x-default": url(main, path),
    }
    return locales.map((locale) => ({
      url: url(locale, path),
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "daily" as const,
      priority,
      alternates: { languages },
    }))
  })
}
