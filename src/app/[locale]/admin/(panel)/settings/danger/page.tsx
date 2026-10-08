import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { resetPreview } from "@/features/settings/reset"
import { requireAdmin } from "@/lib/auth/admin"
import { FactoryReset } from "./factory-reset"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.danger")} · ${t("title")}` }
}

/** Settings → Danger zone: delete all transactions and unsigned / not-held contracts (features/settings/reset.ts). */
export default async function DangerZonePage() {
  await requireAdmin()
  const [t, counts] = await Promise.all([getTranslations("settings"), resetPreview()])
  return (
    <>
      <BreadcrumbTitle title={t("tabs.danger")} />
      <FactoryReset counts={counts} />
    </>
  )
}
