import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { formatIban } from "@/features/registrations/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { getSetting } from "@/lib/settings"
import { PaymentSettingsForm } from "./payment-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.payments")} · ${t("title")}` }
}

const full = (text: { fa?: string; tr?: string; en?: string }) => ({ fa: text.fa ?? "", tr: text.tr ?? "", en: text.en ?? "" })

/** Settings → Payments: how students pay (cash, bank transfer, online payment link). */
export default async function PaymentSettingsPage() {
  await requireAdmin()
  const [t, payment] = await Promise.all([getTranslations("settings"), getSetting("payment")])
  return (
    <>
      <BreadcrumbTitle title={t("tabs.payments")} />
      <PaymentSettingsForm
        saved={{
          cash: payment.cash,
          transfer: { ...payment.transfer, iban: formatIban(payment.transfer.iban), note: full(payment.transfer.note) },
          online: { enabled: payment.online.enabled, note: full(payment.online.note) },
        }}
      />
    </>
  )
}
