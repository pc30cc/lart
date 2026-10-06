import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { getStorageSettings } from "@/features/settings/queries"
import { requireAdmin } from "@/lib/auth/admin"
import { StorageSettingsForm } from "../_components/storage-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.storage")} · ${t("title")}` }
}

export default async function StorageSettingsPage() {
  await requireAdmin()
  const [t, view] = await Promise.all([getTranslations("settings"), getStorageSettings()])
  return (
    <>
      <BreadcrumbTitle title={t("tabs.storage")} />
      <StorageSettingsForm view={view} />
    </>
  )
}
