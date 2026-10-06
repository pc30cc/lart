import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { getWatermarkSettings } from "@/features/settings/queries"
import { requireAdmin } from "@/lib/auth/admin"
import { WatermarkSettingsForm } from "../_components/watermark-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.watermark")} · ${t("title")}` }
}

export default async function WatermarkSettingsPage() {
  await requireAdmin()
  const [t, saved] = await Promise.all([getTranslations("settings"), getWatermarkSettings()])
  return (
    <>
      <BreadcrumbTitle title={t("tabs.watermark")} />
      <WatermarkSettingsForm saved={saved} />
    </>
  )
}
