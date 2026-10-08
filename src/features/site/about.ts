import "server-only"
import { and, asc, eq } from "drizzle-orm"
import { getTranslations } from "next-intl/server"
import { cache } from "react"

import { db } from "@/db"
import { admins } from "@/db/schema"
import { ownText } from "@/lib/format"
import { getBrand, getSetting } from "@/lib/settings"
import { publicUrls } from "@/lib/storage"
import type { AboutData, AboutPartner } from "@/themes/types"
import { getSiteFrame } from "./frame"

/**
 * The partners on the public About page, in `locale`: active partners who
 * chose to be shown (My profile), oldest first. Public fields only (never an
 * email), and each text in this language only (the name falls back to their
 * profile's name: a name reads the same in every language).
 */
export const listAboutPartners = cache(async (locale: string): Promise<AboutPartner[]> => {
  const [rows, url] = await Promise.all([
    db
      .select({
        id: admins.id,
        name: admins.name,
        aboutName: admins.aboutName,
        aboutRole: admins.aboutRole,
        aboutBio: admins.aboutBio,
        portraitPath: admins.portraitPath,
      })
      .from(admins)
      .where(and(eq(admins.active, true), eq(admins.aboutShown, true)))
      .orderBy(asc(admins.createdAt), asc(admins.id)),
    publicUrls(),
  ])
  return rows.map((r) => ({
    key: r.id,
    name: ownText(r.aboutName, locale) || r.name,
    role: ownText(r.aboutRole, locale),
    bio: ownText(r.aboutBio, locale),
    portraitUrl: url(r.portraitPath),
  }))
})

/** Whether the About page has anyone on it (else it is not indexed nor in the sitemap: it would only repeat the footer). */
export async function aboutHasPartners(): Promise<boolean> {
  const [row] = await db
    .select({ id: admins.id })
    .from(admins)
    .where(and(eq(admins.active, true), eq(admins.aboutShown, true)))
    .limit(1)
  return Boolean(row)
}

/** Everything the About page shows, in `locale` (themes/types `AboutData`). */
export async function getAboutData(locale: string): Promise<AboutData> {
  const [t, brand, frame, partners, home, url] = await Promise.all([
    getTranslations({ locale, namespace: "about" }),
    getBrand(locale),
    getSiteFrame(locale),
    listAboutPartners(locale),
    getSetting("home"),
    publicUrls(),
  ])
  return {
    locale,
    brand,
    kicker: t("kicker"),
    title: t("title", { brand }),
    intro: frame.footer.about,
    partners,
    storyImageUrl: url(home.story.image),
    labels: {
      partnersTitle: t("partnersTitle"),
      partnersText: t("partnersText"),
      portraitAlt: (name) => t("portraitAlt", { name }),
      ctaTitle: t("cta.title"),
      ctaText: t("cta.text"),
      ctaButton: t("cta.button"),
    },
  }
}
