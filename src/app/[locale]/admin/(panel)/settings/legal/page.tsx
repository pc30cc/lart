import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { requireAdmin } from "@/lib/auth/admin"
import { getSetting } from "@/lib/settings"
import { LegalSettingsForm } from "./legal-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.legal")} · ${t("title")}` }
}

/** Settings → Legal details: the business behind the site, for the legal pages and the Contact page. */
export default async function LegalSettingsPage() {
  await requireAdmin()
  const [t, saved] = await Promise.all([getTranslations("settings"), getSetting("legal")])
  return (
    <>
      <BreadcrumbTitle title={t("tabs.legal")} />
      <LegalSettingsForm saved={saved} />
    </>
  )
}
