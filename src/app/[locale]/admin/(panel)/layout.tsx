import type { Metadata } from "next"
import { cookies } from "next/headers"
import { getTranslations } from "next-intl/server"
import { Suspense } from "react"

import { AppShell } from "@/components/admin/app-shell"
import { AdminNoticeToast } from "@/components/admin/notice-toast"
import { adminPhotoUrl } from "@/features/partners/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { getBrand } from "@/lib/settings"

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
  const [{ admin }, brand, store] = await Promise.all([requireAdmin(), getBrand(locale), cookies()])

  return (
    <AppShell
      brand={brand}
      admin={{ name: admin.name, email: admin.email, photoUrl: adminPhotoUrl(admin.photoPath) }}
      defaultOpen={store.get("sidebar_state")?.value !== "false"}
    >
      {children}
      <Suspense>
        <AdminNoticeToast />
      </Suspense>
    </AppShell>
  )
}
