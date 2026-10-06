import { CalendarPlusIcon, CalendarRangeIcon, ImageIcon, PlusIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { DataTable, type Column } from "@/components/admin/data-table/data-table"
import { parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import { countWorkshopViews, listWorkshops, type WorkshopRow } from "@/features/workshops/queries"
import { workshopTable, workshopViews, type WorkshopView } from "@/features/workshops/schema"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatNumber, formatTimeRange, formatWeekday, localized } from "@/lib/format"
import { cn } from "@/lib/utils"
import { FillMeter, WorkshopStatusBadge } from "./_components/workshop-status"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workshops")
  return { title: t("title") }
}

/** Upcoming and planned workshops first, newest history first. */
const ascendingViews: WorkshopView[] = ["upcoming", "awaiting_signature", "published", "confirmed"]

export default async function WorkshopsPage({ searchParams }: PageProps<"/[locale]/admin/workshops">) {
  await requireAdmin()
  const [t, locale, sp] = await Promise.all([getTranslations("workshops"), getLocale(), searchParams])
  const requested = typeof sp.view === "string" ? (sp.view as WorkshopView) : "upcoming"
  const params = parseTableParams(sp, {
    sort: workshopTable.sort,
    defaultSort: "startsAt",
    defaultDir: ascendingViews.includes(requested) ? "asc" : "desc",
    filters: workshopTable.filters,
  })
  const [{ view, rows, total }, counts] = await Promise.all([listWorkshops(params, locale), countWorkshopViews()])

  const newButton = (
    <Button asChild size="lg" className="px-4">
      <Link href="/admin/workshops/new">
        <PlusIcon />
        {t("new")}
      </Link>
    </Button>
  )

  const columns: Column<WorkshopRow>[] = [
    {
      key: "title",
      header: t("table.workshop"),
      sortable: true,
      cell: (row) => (
        <Link href={`/admin/workshops/${row.id}`} className="group/name flex min-w-0 items-center gap-3">
          <span className="bg-muted ring-foreground/8 relative hidden aspect-[4/3] w-14 shrink-0 overflow-hidden rounded-lg ring-1 sm:block">
            {row.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- CDN URL decided at runtime
              <img src={row.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
            ) : (
              <ImageIcon className="text-muted-foreground/60 absolute inset-0 m-auto size-4" />
            )}
          </span>
          <span className="min-w-0">
            <span className="group-hover/name:text-primary block truncate font-medium transition-colors">
              {localized(row.title, locale)}
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {localized(row.category, locale)}
              <span className="md:hidden"> · {localized(row.instructor, locale)}</span>
            </span>
          </span>
        </Link>
      ),
    },
    {
      key: "startsAt",
      header: t("table.date"),
      sortable: true,
      cell: (row) => (
        <span className="block whitespace-nowrap">
          <span className="block text-sm">{formatDate(row.startsAt, locale, "medium")}</span>
          <span className="text-muted-foreground block text-xs">
            {formatWeekday(row.startsAt, locale)} · <bdi className="tabular-nums">{formatTimeRange(row.startsAt, row.endsAt, locale)}</bdi>
          </span>
        </span>
      ),
    },
    {
      key: "instructor",
      header: t("table.instructor"),
      hideBelow: "md",
      cell: (row) => <span className="text-sm">{localized(row.instructor, locale)}</span>,
    },
    {
      key: "fill",
      header: t("table.fill"),
      sortable: true,
      hideBelow: "sm",
      cell: (row) => (
        <FillMeter
          confirmed={row.confirmed}
          min={row.minCapacity}
          max={row.maxCapacity}
          label={t("table.fillValue", { confirmed: formatNumber(row.confirmed, locale), max: formatNumber(row.maxCapacity, locale) })}
        />
      ),
    },
    {
      key: "price",
      header: t("table.price"),
      sortable: true,
      align: "end",
      hideBelow: "lg",
      cell: (row) => <Money value={row.price} />,
    },
    {
      key: "status",
      header: t("table.status"),
      align: "end",
      cell: (row) => <WorkshopStatusBadge status={row.status} />,
    },
  ]

  const hasAny = counts.all > 0
  const tabHref = (v: WorkshopView) => ({
    pathname: "/admin/workshops",
    query: { ...(v === "upcoming" ? {} : { view: v }), ...(params.q ? { q: params.q } : {}) },
  })

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={hasAny ? newButton : undefined} />

      {!hasAny ? (
        <EmptyState
          icon={CalendarPlusIcon}
          title={t("empty.first.title")}
          description={t("empty.first.description")}
          action={newButton}
        />
      ) : (
        <div className="space-y-4">
          <nav aria-label={t("views.label")} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <ul className="bg-muted/60 flex w-max gap-0.5 rounded-xl p-1">
              {workshopViews.map((v) => {
                const current = v === view
                return (
                  <li key={v}>
                    <Link
                      href={tabHref(v)}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-all",
                        current
                          ? "bg-background text-foreground ring-foreground/8 shadow-xs ring-1"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t(`views.${v}`)}
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-xs tabular-nums",
                          current ? "bg-primary/10 text-primary" : "bg-foreground/5",
                        )}
                      >
                        {formatNumber(counts[v], locale)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          {total === 0 && !params.q ? (
            <EmptyState
              icon={CalendarRangeIcon}
              title={t(`empty.views.${view}.title`)}
              description={t(`empty.views.${view}.description`)}
              action={view === "upcoming" ? newButton : undefined}
            />
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              total={total}
              params={params}
              rowKey={(row) => row.id}
              searchPlaceholder={t("table.searchPlaceholder")}
            />
          )}
        </div>
      )}
    </>
  )
}
