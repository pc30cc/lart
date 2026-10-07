import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { getEmailSettings } from "@/features/settings/queries"
import { requireAdmin } from "@/lib/auth/admin"
import { EmailSettingsForm } from "../_components/email-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.email")} · ${t("title")}` }
}

export default async function EmailSettingsPage() {
  const { admin } = await requireAdmin()
  const [t, view] = await Promise.all([getTranslations("settings"), getEmailSettings()])
  return (
    <>
      <BreadcrumbTitle title={t("tabs.email")} />
      <EmailSettingsForm view={view} adminEmail={admin.email} />
    </>
  )
}
