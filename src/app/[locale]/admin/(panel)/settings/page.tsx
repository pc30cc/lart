import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { getGeneralSettings } from "@/features/settings/queries"
import { requireAdmin } from "@/lib/auth/admin"
import { GeneralSettingsForm } from "./_components/general-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: t("title") }
}

export default async function GeneralSettingsPage() {
  await requireAdmin()
  const saved = await getGeneralSettings()
  return <GeneralSettingsForm saved={saved} />
}
