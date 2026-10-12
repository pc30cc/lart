import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { requireAdmin } from "@/lib/auth/admin"
import { getSetting } from "@/lib/settings"
import { TelegramSettingsForm } from "./telegram-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.telegram")} · ${t("title")}` }
}

/** Settings → Telegram: the channel the workshops are sent to (each one after a super admin's go, on its page). */
export default async function TelegramSettingsPage() {
  await requireAdmin()
  const [t, saved] = await Promise.all([getTranslations("settings"), getSetting("telegram")])
  return (
    <>
      <BreadcrumbTitle title={t("tabs.telegram")} />
      {/* The token is never sent to the page: only whether one is saved. */}
      <TelegramSettingsForm saved={{ chatId: saved.chatId, locale: saved.locale, tokenSaved: Boolean(saved.botTokenEnc) }} />
    </>
  )
}
