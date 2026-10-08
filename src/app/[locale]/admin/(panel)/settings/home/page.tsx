import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { getHomeDefaults, getHomeSettings } from "@/features/site/home-settings"
import { requireAdmin } from "@/lib/auth/admin"
import { DEFAULT_THEME, isThemeId } from "@/themes/ids"
import { HomeSettingsForm } from "./home-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.home")} · ${t("title")}` }
}

/** The home page's content: hero, sections shown or hidden, their texts and photos, the footer. */
export default async function HomeSettingsPage() {
  await requireAdmin()
  const [t, { saved, urls, theme }, defaults] = await Promise.all([getTranslations("settings"), getHomeSettings(), getHomeDefaults()])
  return (
    <>
      <BreadcrumbTitle title={t("tabs.home")} />
      <HomeSettingsForm saved={saved} urls={urls} defaults={defaults} classic={!isThemeId(theme) || theme === DEFAULT_THEME} />
    </>
  )
}
