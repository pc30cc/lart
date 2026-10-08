import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { requireAdmin } from "@/lib/auth/admin"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.appearance")} · ${t("title")}` }
}

/** Placeholder: the form comes with the theme work. */
export default async function Page() {
  await requireAdmin()
  const t = await getTranslations("settings")
  return <BreadcrumbTitle title={t("tabs.appearance")} />
}
