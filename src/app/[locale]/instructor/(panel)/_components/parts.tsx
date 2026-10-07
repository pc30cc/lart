import { ArrowLeftIcon, CalendarDaysIcon, ChevronRightIcon, MapPinIcon, UsersRoundIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { StatusBadge, type StatusTone } from "@/components/admin/status-badge"
import type { ContractState, WorkshopCard as Workshop } from "@/features/instructor-panel/queries"
import { panelStatus, type PanelStatus } from "@/features/instructor-panel/schema"
import { Link } from "@/i18n/navigation"
import { formatDate, formatTimeRange, localized } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Small building blocks of the instructor panel's pages (server or client):
 * a page title, a back link, a status in plain words and a workshop card.
 */

export function PageTitle({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 print:hidden">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl rtl:tracking-normal">{title}</h1>
        {subtitle && <p className="text-muted-foreground max-w-prose text-base text-pretty">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-2 mb-4 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium outline-none focus-visible:ring-3 print:hidden"
    >
      <ArrowLeftIcon className="size-4 rtl:rotate-180" />
      {label}
    </Link>
  )
}

const statusTone: Record<PanelStatus, StatusTone> = {
  toSign: "warning",
  open: "info",
  confirmed: "success",
  finished: "neutral",
  cancelled: "danger",
}

export const contractTone: Record<ContractState, StatusTone> = {
  toSign: "warning",
  signed: "success",
  replaced: "neutral",
  closed: "neutral",
}

/** A workshop's status in plain words. */
export function WorkshopStatus({ status, className }: { status: PanelStatus; className?: string }) {
  const t = useTranslations("instructorPanel.status")
  return (
    <StatusBadge tone={statusTone[status]} className={className}>
      {t(status)}
    </StatusBadge>
  )
}

/** A section of a page with its heading. */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** The calm card of the panel. */
export const card = "bg-card text-card-foreground ring-foreground/8 rounded-2xl shadow-xs ring-1"

/** One workshop: title, status, date with weekday, time, venue and places taken. Opens its page. */
export function WorkshopCard({ workshop, now }: { workshop: Workshop; now?: Date }) {
  const t = useTranslations("instructorPanel.workshop")
  const locale = useLocale()
  const status = panelStatus(workshop, now)

  return (
    <Link
      href={`/instructor/workshops/${workshop.id}`}
      className={cn(
        card,
        "group focus-visible:ring-ring/50 flex items-center gap-3 p-4 outline-none transition-shadow hover:shadow-md focus-visible:ring-3 sm:p-5",
      )}
    >
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <h3 className="min-w-0 text-base font-semibold text-pretty">{localized(workshop.title, locale)}</h3>
          <WorkshopStatus status={status} />
        </div>
        <ul className="text-muted-foreground space-y-1.5 text-sm">
          <li className="flex items-start gap-2">
            <CalendarDaysIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {formatDate(workshop.startsAt, locale, "full")}
              <span aria-hidden> · </span>
              <bdi>{formatTimeRange(workshop.startsAt, workshop.endsAt, locale)}</bdi>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <MapPinIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0">{localized(workshop.venue, locale)}</span>
          </li>
          {status !== "toSign" && status !== "cancelled" && (
            <li className="flex items-start gap-2">
              <UsersRoundIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t("places", { count: workshop.registered, max: workshop.maxCapacity })}</span>
            </li>
          )}
        </ul>
      </div>
      <ChevronRightIcon className="text-muted-foreground/60 group-hover:text-foreground size-5 shrink-0 transition-colors rtl:rotate-180" aria-hidden />
    </Link>
  )
}
