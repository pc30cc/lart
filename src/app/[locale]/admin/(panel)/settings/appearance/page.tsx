import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { getAppearanceSettings } from "@/features/settings/appearance"
import { requireAdmin } from "@/lib/auth/admin"
import { getBrand } from "@/lib/settings"
import { fontPoolCss } from "@/themes/font-css"
import { AppearanceSettingsForm } from "./appearance-form"
import { LogoPanel } from "./logo-panel"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.appearance")} · ${t("title")}` }
}

/** The site's logo, theme and fonts (Settings → Appearance). */
export default async function AppearanceSettingsPage() {
  await requireAdmin()
  const locale = await getLocale()
  const [t, saved, brand] = await Promise.all([getTranslations("settings"), getAppearanceSettings(), getBrand(locale)])
  return (
    <>
      {/* Every font of the registry, for the preview (src/themes/font-css.ts; registry values only). */}
      <style dangerouslySetInnerHTML={{ __html: fontPoolCss() }} />
      <BreadcrumbTitle title={t("tabs.appearance")} />
      <div className="space-y-6">
        <LogoPanel saved={saved.logo} brand={brand} />
        <AppearanceSettingsForm saved={{ theme: saved.theme, fonts: saved.fonts }} brand={brand} />
      </div>
    </>
  )
}
