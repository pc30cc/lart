import "server-only"
import { getTranslations } from "next-intl/server"

import { locales } from "@/i18n/routing"
import { requireAdmin } from "@/lib/auth/admin"
import { getSetting } from "@/lib/settings"
import { publicUrls } from "@/lib/storage"
import { homeFiles, HOME_STEPS_MAX, type HomeDefaults, type Texts } from "./home-schema"

/**
 * The Home page settings page: the saved `home` setting, the URL of every
 * file it uses (null when the storage setting cannot be used) and the active
 * theme (the classic one shows only part of it).
 */
export async function getHomeSettings() {
  await requireAdmin()
  const [saved, url, theme] = await Promise.all([getSetting("home"), publicUrls(), getSetting("theme")])
  const urls: Record<string, string | null> = Object.fromEntries(homeFiles(saved).map((path) => [path, url(path)]))
  return { saved, urls, theme }
}

/** The template's own texts in every language (messages/<locale>/home.json), the form's placeholders. */
export async function getHomeDefaults(): Promise<HomeDefaults> {
  await requireAdmin()
  const translators = await Promise.all(locales.map((locale) => getTranslations({ locale, namespace: "home" })))
  const texts = (key: string): Texts =>
    Object.fromEntries(locales.map((locale, i) => [locale, translators[i](key as never)])) as Texts
  return {
    hero: { title: texts("hero.title"), subtitle: texts("hero.subtitle"), button: texts("hero.button") },
    story: { title: texts("story.title"), text: texts("story.text"), button: texts("story.button") },
    crafts: { title: texts("crafts.title") },
    past: { title: texts("past.title") },
    steps: {
      title: texts("steps.title"),
      items: Array.from({ length: HOME_STEPS_MAX }, (_, i) => ({
        title: texts(`steps.step${i + 1}.title`),
        text: texts(`steps.step${i + 1}.text`),
      })),
    },
    footer: { about: texts("footer.about") },
  }
}
