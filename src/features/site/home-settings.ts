import "server-only"
import { eq, sql } from "drizzle-orm"
import { getTranslations } from "next-intl/server"

import { db, type Tx } from "@/db"
import { settings } from "@/db/schema"
import { locales } from "@/i18n/routing"
import { requireAdmin } from "@/lib/auth/admin"
import { getSetting, settingDefaults, settingSchemas, type SettingValue } from "@/lib/settings"
import { publicUrls } from "@/lib/storage"
import { homeFiles, HOME_STEPS_MAX, type HomeDefaults, type Texts } from "./home-schema"

/**
 * The saved `home` setting (the default when there is none, or it no longer
 * parses) and its version: the row's `updated_at` in microseconds, "" before
 * the first save. Read in one query, so the version is the value's own.
 * `lock` holds the row until the transaction ends.
 */
export async function readHome(tx: Tx | typeof db = db, { lock = false } = {}) {
  const query = tx
    .select({ value: settings.value, version: sql<string>`(extract(epoch from ${settings.updatedAt}) * 1000000)::bigint::text` })
    .from(settings)
    .where(eq(settings.key, "home"))
  const [row] = lock ? await query.for("update") : await query
  const parsed = row ? settingSchemas.home.safeParse(row.value) : null
  const home: SettingValue<"home"> = parsed?.success ? parsed.data : settingDefaults.home
  return { home, version: row?.version ?? "" }
}

/**
 * The Home page settings page: the saved `home` setting and its version (the
 * form sends it back, see `saveHomeSettings`), the URL of every file it uses
 * (null when the storage setting cannot be used) and the active theme (the
 * classic one shows only part of it).
 */
export async function getHomeSettings() {
  await requireAdmin()
  const [{ home: saved, version }, url, theme] = await Promise.all([readHome(), publicUrls(), getSetting("theme")])
  const urls: Record<string, string | null> = Object.fromEntries(homeFiles(saved).map((path) => [path, url(path)]))
  return { saved, version, urls, theme }
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
