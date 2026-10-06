import { CalendarDaysIcon, MapPinIcon, UserRoundIcon } from "lucide-react"
import { getLocale, getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/admin/page-header"
import type { Workshop } from "@/features/workshops/queries"
import { displayStatus } from "@/features/workshops/schema"
import { Link } from "@/i18n/navigation"
import { formatDate, formatNumber, formatTimeRange, localized } from "@/lib/format"
import { cn } from "@/lib/utils"
import { WorkshopStatusBadge } from "./workshop-status"
import { WorkshopTabsNav } from "./workshop-tabs-nav"

export type WorkshopTab = "overview" | "contract" | "registrations" | "gallery" | "finances"

/**
 * Top of every workshop page: title, status, date, venue and instructor, the
 * page's actions and the tabs (overview, contract, registrations, gallery,
 * finances). The finances page can use it too:
 *   <WorkshopHeader workshop={await getWorkshop(id)} active="finances" />
 */
export async function WorkshopHeader({
  workshop,
  active,
  actions,
}: {
  workshop: Workshop
  active: WorkshopTab
  actions?: React.ReactNode
}) {
  const [t, locale] = await Promise.all([getTranslations("workshops"), getLocale()])
  const base = `/admin/workshops/${workshop.id}`
  const registered = workshop.registered.confirmed + workshop.registered.pending
  const tabs: { key: WorkshopTab; href: string; label: string; count?: number }[] = [
    { key: "overview", href: base, label: t("tabs.overview") },
    { key: "contract", href: `${base}/contract`, label: t("tabs.contract") },
    { key: "registrations", href: `${base}/registrations`, label: t("tabs.registrations"), count: registered },
    { key: "gallery", href: `${base}/gallery`, label: t("tabs.gallery") },
    { key: "finances", href: `${base}/finances`, label: t("tabs.finances") },
  ]

  return (
    <div className="mb-6 md:mb-8 print:hidden">
      <PageHeader
        className="mb-5 md:mb-6"
        title={localized(workshop.title, locale)}
        back={{ href: "/admin/workshops", label: t("backToList") }}
        actions={actions}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <WorkshopStatusBadge status={displayStatus(workshop)} />
            <span className="inline-flex items-center gap-1.5">
              <CalendarDaysIcon className="size-4 opacity-70" />
              {formatDate(workshop.startsAt, locale, "full")}
              <span className="opacity-60">·</span>
              <bdi className="tabular-nums">{formatTimeRange(workshop.startsAt, workshop.endsAt, locale)}</bdi>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <MapPinIcon className="size-4 shrink-0 opacity-70" />
              <span className="truncate">{localized(workshop.venue, locale)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UserRoundIcon className="size-4 opacity-70" />
              {localized(workshop.instructor.displayName, locale)}
            </span>
          </span>
        }
      />
      <WorkshopTabsNav label={t("tabs.label")} active={active}>
        <ul className="flex min-w-max gap-1 border-b">
          {tabs.map((tab) => {
            const current = tab.key === active
            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "relative inline-flex h-10 items-center gap-2 px-3 text-sm font-medium transition-colors",
                    "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors",
                    current
                      ? "text-foreground after:bg-primary"
                      : "text-muted-foreground hover:text-foreground after:bg-transparent",
                  )}
                >
                  {tab.label}
                  {tab.count ? (
                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-px text-xs tabular-nums">
                      {formatNumber(tab.count, locale)}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      </WorkshopTabsNav>
    </div>
  )
}
