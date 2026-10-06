import { getTranslations } from "next-intl/server"

import { requireAdmin } from "@/lib/auth/admin"
import { SettingsNav } from "./_components/settings-nav"

/** Title and tabs shared by the settings pages (each page checks the admin again). */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  const t = await getTranslations("settings")

  return (
    <>
      <header className="mb-5 space-y-1.5 md:mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-[1.75rem]">{t("title")}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm text-pretty md:text-base">{t("description")}</p>
      </header>
      <SettingsNav />
      {children}
    </>
  )
}
