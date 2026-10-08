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
 * The partners on the public Our story page (/story), in `locale`: active partners who
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
  // The key is the place on the page, not the partner's id: no internal id reaches the public page.
  return rows.map((r, i) => ({
    key: `partner-${i + 1}`,
    name: ownText(r.aboutName, locale) || r.name,
    role: ownText(r.aboutRole, locale),
    bio: ownText(r.aboutBio, locale),
    portraitUrl: url(r.portraitPath),
  }))
})

/** Whether the Our story page has anyone on it (else it is not indexed nor in the sitemap: it would be nearly empty). */
export async function storyHasPartners(): Promise<boolean> {
  const [row] = await db
    .select({ id: admins.id })
    .from(admins)
    .where(and(eq(admins.active, true), eq(admins.aboutShown, true)))
    .limit(1)
  return Boolean(row)
}

/**
 * Everything a page shows, in `locale` (themes/types `AboutData`): the About
 * page (/about) is the brand's own words (Settings → Home page → About page,
 * else the footer's "About us" text) and nobody else; the Our story page (/story) is the partners who chose to be on it.
 */
export async function getAboutData(locale: string, page: "about" | "story"): Promise<AboutData> {
  const [t, brand, frame, partners, home, url] = await Promise.all([
    getTranslations({ locale, namespace: "about" }),
    getBrand(locale),
    getSiteFrame(locale),
    page === "story" ? listAboutPartners(locale) : [],
    getSetting("home"),
    publicUrls(),
  ])
  return {
    page,
    locale,
    brand,
    ...(page === "story"
      ? { kicker: brand, title: t("story.title"), intro: t("story.intro", { brand }) }
      : { kicker: t("kicker"), title: t("title", { brand }), intro: ownText(home.aboutPage.text, locale) || frame.footer.about }),
    partners,
    storyImageUrl: url(home.story.image),
    labels: {
      partnersTitle: t("partnersTitle"),
      portraitAlt: (name) => t("portraitAlt", { name }),
      ctaTitle: t("cta.title"),
      ctaText: t("cta.text"),
      ctaButton: t("cta.button"),
    },
  }
}
