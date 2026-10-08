import "server-only"
import { getTranslations } from "next-intl/server"

import { listOpenWorkshops } from "@/features/registrations/public"
import { getBrand, getSetting } from "@/lib/settings"
import { publicUrls } from "@/lib/storage"
import type { HeroMedia, HomeData } from "@/themes/types"
import { listPastWorkshops, listPublicCategories } from "./public"

/** How many open workshops the home page gets (a theme shows as many as it has room for). */
const HOME_WORKSHOPS = 8

type Localized = { fa?: string; tr?: string; en?: string }

/**
 * Everything the home page shows, in `locale`: the `home` setting (Settings →
 * Home page) with the bundled texts (messages/<locale>/home.json) where a
 * field is empty, the next workshops, the categories and past workshops.
 */
export async function getHomeData(locale: string): Promise<HomeData> {
  const [t, ts, tl, brand, seo, home, upcoming, categories, url] = await Promise.all([
    getTranslations({ locale, namespace: "home" }),
    getTranslations({ locale, namespace: "site.home" }),
    getTranslations({ locale, namespace: "registration.list" }),
    getBrand(locale),
    getSetting("seo"),
    getSetting("home"),
    listOpenWorkshops(locale, { limit: HOME_WORKSHOPS }),
    listPublicCategories(locale),
    publicUrls(),
  ])
  const text = (value: Localized | undefined, fallback: string) => value?.[locale as keyof Localized]?.trim() || fallback
  const past = home.past.show ? await listPastWorkshops(locale) : []

  const images = home.hero.images.map((p) => url(p)).filter((u): u is string => Boolean(u))
  const video = url(home.hero.video)
  const media: HeroMedia =
    home.hero.media === "video" && video
      ? { kind: "video", url: video, posterUrl: url(home.hero.poster) }
      : home.hero.media === "images" && images.length > 0
        ? { kind: "images", images }
        : { kind: "theme" }

  const steps = home.steps.items.length
    ? home.steps.items.map((item, i) => ({
        title: text(item.title, t(`steps.step${(i % 4) + 1}.title`)),
        text: text(item.text, t(`steps.step${(i % 4) + 1}.text`)),
      }))
    : [1, 2, 3, 4].map((n) => ({ title: t(`steps.step${n}.title`), text: t(`steps.step${n}.text`) }))

  return {
    locale,
    brand,
    tagline: text(seo.description, ts("tagline")),
    hero: {
      media,
      title: text(home.hero.title, t("hero.title")),
      subtitle: text(home.hero.subtitle, t("hero.subtitle")),
      button: text(home.hero.button, t("hero.button")),
    },
    upcoming,
    categories,
    story: home.story.show
      ? {
          title: text(home.story.title, t("story.title")),
          text: text(home.story.text, t("story.text")),
          button: text(home.story.button, t("story.button")),
          imageUrl: url(home.story.image),
        }
      : null,
    crafts: home.crafts.show ? { title: text(home.crafts.title, t("crafts.title")), imageUrl: url(home.crafts.image) } : null,
    past: home.past.show && past.length > 0 ? { title: text(home.past.title, t("past.title")), workshops: past } : null,
    steps: home.steps.show ? { title: text(home.steps.title, t("steps.title")), items: steps, imageUrl: url(home.steps.image) } : null,
    labels: {
      upcomingTitle: ts("upcomingTitle"),
      allWorkshops: ts("allWorkshops"),
      seeAllWorkshops: ts("cta"),
      emptyTitle: tl("emptyTitle"),
      emptyText: tl("emptyText"),
    },
  }
}
