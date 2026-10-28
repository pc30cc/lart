import type { Metadata } from "next"
import { cookies } from "next/headers"
import { getTranslations } from "next-intl/server"
import { Suspense } from "react"

import { AppShell } from "@/components/admin/app-shell"
import { TranslateProvider } from "@/components/admin/form/translate-context"
import { AdminNoticeToast } from "@/components/admin/notice-toast"
import { requireAdmin } from "@/lib/auth/admin"
import { localized } from "@/lib/format"
import { isMaintenance, latestWorkshop } from "@/lib/maintenance"
import { getBrand, getSetting } from "@/lib/settings"
import { publicUrls } from "@/lib/storage"

export async function generateMetadata({ params }: LayoutProps<"/[locale]/admin">): Promise<Metadata> {
  const { locale } = await params
  const [brand, t] = await Promise.all([getBrand(locale), getTranslations("admin")])
  return {
    title: { default: t("meta.title"), template: `%s · ${t("meta.title")} · ${brand}` },
    robots: { index: false, follow: false, nocache: true },
  }
}

/**
 * The signed-in panel. This check is for the shell only: every page and
 * server action checks `requireAdmin()` again (layouts are not re-run on navigation).
 */
export default async function PanelLayout({ children, params }: LayoutProps<"/[locale]/admin">) {
  const { locale } = await params
  const [{ admin }, brand, store, url, logo, maintenance] = await Promise.all([
    requireAdmin(),
    getBrand(locale),
    cookies(),
    publicUrls(),
    getSetting("logo"),
    isMaintenance(),
  ])
  const [latest, t] = maintenance ? await Promise.all([latestWorkshop(), getTranslations("admin.maintenance")]) : [null, null]

  return (
    <AppShell
      brand={brand}
      logo={logo}
      admin={{ name: admin.name, email: admin.email, photoUrl: url(admin.photoPath) }}
      defaultOpen={store.get("sidebar_state")?.value !== "false"}
    >
      {t && (
        // Maintenance (lib/maintenance.ts): what still works, so a refused change is no surprise.
        <p role="status" className="bg-warning/10 border-warning/30 text-foreground mb-6 rounded-xl border px-4 py-3 text-sm text-pretty">
          {t("notice", { workshop: latest ? localized(latest.title, locale) : "—" })}
        </p>
      )}
      <TranslateProvider audience="admin">{children}</TranslateProvider>
      <Suspense>
        <AdminNoticeToast />
      </Suspense>
    </AppShell>
  )
}
