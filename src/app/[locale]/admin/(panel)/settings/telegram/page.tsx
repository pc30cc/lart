import { asc, eq } from "drizzle-orm"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { db } from "@/db"
import { admins } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { getSetting } from "@/lib/settings"
import { TelegramAdminsForm } from "./admins-form"
import { TelegramSettingsForm } from "./telegram-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.telegram")} · ${t("title")}` }
}

/**
 * Settings → Telegram: the channel the workshops are sent to (each one after
 * a super admin's go, on its page), and the admins who get each registration
 * and receipt from the bot, with "Confirm payment".
 */
export default async function TelegramSettingsPage() {
  await requireAdmin()
  const [t, saved, team, active] = await Promise.all([
    getTranslations("settings"),
    getSetting("telegram"),
    getSetting("telegramAdmins"),
    db.select({ id: admins.id, name: admins.name }).from(admins).where(eq(admins.active, true)).orderBy(asc(admins.name)),
  ])
  const people = active.map((a) => {
    const own = team.people.find((p) => p.adminId === a.id)
    return { adminId: a.id, name: a.name, username: own?.username ?? "", connected: Boolean(own?.chatId) }
  })
  return (
    <>
      <BreadcrumbTitle title={t("tabs.telegram")} />
      {/* The token is never sent to the page: only whether one is saved. */}
      <TelegramSettingsForm saved={{ chatId: saved.chatId, locale: saved.locale, tokenSaved: Boolean(saved.botTokenEnc) }} />
      <div className="mt-10">
        <TelegramAdminsForm
          people={people}
          notify={team.notify}
          locale={team.locale}
          botUsername={team.botUsername}
          tokenSaved={Boolean(saved.botTokenEnc)}
        />
      </div>
    </>
  )
}
