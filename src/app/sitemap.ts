import type { MetadataRoute } from "next"
import { connection } from "next/server"

import { absoluteUrl } from "@/app/[locale]/(site)/workshops/_components/seo"
import { sitemapWorkshops } from "@/features/registrations/public"
import { locales } from "@/i18n/routing"
import { getSetting } from "@/lib/settings"

/**
 * /sitemap.xml: the workshops list and every open workshop page, in each
 * language, each with its hreflang alternates (fa, tr, en, and x-default: the
 * default language), as the pages' own metadata gives them. Built on each
 * request, so a workshop appears as soon as it is published. Private areas
 * (admin, instructor, account) are never listed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection()
  const [workshops, defaultLocale] = await Promise.all([sitemapWorkshops(), getSetting("defaultLocale")])
  const latest = workshops.reduce<Date | undefined>((a, w) => (!a || w.updatedAt > a ? w.updatedAt : a), undefined)
  const pages = [
    { path: "/workshops", lastModified: latest, priority: 1 },
    ...workshops.map((w) => ({ path: `/workshops/${w.slug}`, lastModified: w.updatedAt, priority: 0.8 })),
  ]
  return pages.flatMap(({ path, lastModified, priority }) => {
    const languages = {
      ...Object.fromEntries(locales.map((l) => [l, absoluteUrl(`/${l}${path}`)])),
      "x-default": absoluteUrl(`/${defaultLocale}${path}`),
    }
    return locales.map((locale) => ({
      url: absoluteUrl(`/${locale}${path}`),
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "daily" as const,
      priority,
      alternates: { languages },
    }))
  })
}
