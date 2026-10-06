import { PlusIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"
import { Suspense } from "react"

import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import { DashboardContent, DashboardSkeleton } from "@/features/dashboard/components/dashboard"
import { partOfDay } from "@/features/dashboard/metrics"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, zonedParts } from "@/lib/format"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.nav")
  return { title: t("dashboard") }
}

/** The panel's home: a greeting right away, the figures stream in below it. */
export default async function DashboardPage() {
  const { admin } = await requireAdmin()
  const [t, locale] = await Promise.all([getTranslations("dashboard"), getLocale()])
  const now = new Date()
  const firstName = admin.name.trim().split(/\s+/)[0]

  return (
    <>
      <PageHeader
        title={t(`greeting.${partOfDay(zonedParts(now).time)}`, { name: firstName })}
        description={t("intro", { date: formatDate(now, locale, "full") })}
        actions={
          <Button asChild size="lg" className="px-4">
            <Link href="/admin/workshops/new">
              <PlusIcon />
              {t("newWorkshop")}
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </>
  )
}
