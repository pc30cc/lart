import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { listActivePartners } from "@/features/money/queries"
import { requireAdmin } from "@/lib/auth/admin"
import { getSetting } from "@/lib/settings"
import { MoneySettingsForm } from "./money-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.money")} · ${t("title")}` }
}

/** Settings → Money: withdrawals (closed for now) and the partner who pays the costs from the wallet. */
export default async function MoneySettingsPage() {
  await requireAdmin()
  const [t, money, partners] = await Promise.all([getTranslations("settings"), getSetting("money"), listActivePartners()])
  return (
    <>
      <BreadcrumbTitle title={t("tabs.money")} />
      <MoneySettingsForm
        saved={{ withdrawals: money.withdrawals, spenderId: money.spenderId ?? "" }}
        partners={partners.map((p) => ({ id: p.adminId, name: p.name }))}
      />
    </>
  )
}
