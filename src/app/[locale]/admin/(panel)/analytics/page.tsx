import { ChartLineIcon, MonitorIcon, SmartphoneIcon, TabletIcon, type LucideIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { PageHeader } from "@/components/admin/page-header"
import { VisitsChart } from "@/features/analytics/components/visits-chart"
import { getVisitStats, hasViews, parseRange, ranges } from "@/features/analytics/queries"
import { Panel } from "@/features/dashboard/components/panel"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatNumber, formatPercent, localized } from "@/lib/format"
import { cn } from "@/lib/utils"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("analytics")
  return { title: t("title") }
}

const deviceIcons: Record<string, LucideIcon> = { mobile: SmartphoneIcon, tablet: TabletIcon, desktop: MonitorIcon }

/**
 * The site's visit statistics (counted by the site itself, without cookies:
 * features/analytics): people and pages seen per day over 7, 30, 90 or 365
 * days, compared with the period before, the most seen pages, where people
 * came from, their devices, languages and countries, and who is on the site now.
 */
export default async function AnalyticsPage({ searchParams }: PageProps<"/[locale]/admin/analytics">) {
  await requireAdmin()
  const days = parseRange((await searchParams).days)
  const [t, locale, stats, any] = await Promise.all([getTranslations("analytics"), getLocale(), getVisitStats(days), hasViews()])
  const n = (v: number) => formatNumber(v, locale)

  const header = (
    <PageHeader
      title={t("title")}
      actions={
        <nav aria-label={t("range.label")} className="bg-muted inline-flex rounded-lg p-1">
          {ranges.map((r) => (
            <Link
              key={r}
              href={r === 30 ? "/admin/analytics" : `/admin/analytics?days=${r}`}
              aria-current={r === days ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                r === days ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`range.${r}`)}
            </Link>
          ))}
        </nav>
      }
    />
  )
  if (!any) {
    return (
      <>
        {header}
        <EmptyState icon={ChartLineIcon} title={t("empty.title")} description={t("empty.description")} />
      </>
    )
  }

  const { totals } = stats
  const change = (now: number, before: number) => (before > 0 ? (now - before) / before : null)
  const cards = [
    { label: t("cards.visitors"), value: totals.visitors, delta: change(totals.visitors, totals.previous.visitors) },
    { label: t("cards.views"), value: totals.views, delta: change(totals.views, totals.previous.views) },
    {
      label: t("cards.perVisitor"),
      text: totals.visitors > 0 ? formatNumber(totals.views / totals.visitors, locale, { maximumFractionDigits: 1 }) : "—",
    },
    { label: t("cards.live"), value: stats.liveNow, live: true },
  ]
  const share = (part: number, rows: { visitors: number }[]) => {
    const all = rows.reduce((s, r) => s + r.visitors, 0)
    return all > 0 ? part / all : 0
  }

  return (
    <>
      {header}
      <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map((card) => (
            <div key={card.label} className="bg-card ring-foreground/8 rounded-xl px-4 py-3 shadow-xs ring-1">
              <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
                {card.live && <span aria-hidden className="bg-success size-2 animate-pulse rounded-full" />}
                {card.label}
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{card.text ?? n(card.value ?? 0)}</dd>
              {card.delta !== undefined && (
                <dd className="text-muted-foreground mt-0.5 text-xs">
                  {card.delta === null ? (
                    t("cards.noPrevious")
                  ) : (
                    <>
                      <bdi className={cn("font-medium tabular-nums", card.delta > 0 ? "text-success" : card.delta < 0 ? "text-destructive" : undefined)}>
                        {card.delta > 0 ? "▲ " : card.delta < 0 ? "▼ " : ""}
                        {formatPercent(Math.abs(card.delta), locale, 0)}
                      </bdi>{" "}
                      {t("cards.vsPrevious")}
                    </>
                  )}
                </dd>
              )}
            </div>
          ))}
        </dl>

        <Panel id="analytics-daily" title={t("daily.title")} description={t("daily.description")}>
          <VisitsChart data={stats.daily} />
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel id="analytics-pages" title={t("pages.title")} description={t("pages.description")}>
            <RankList
              rows={stats.pages.map((p) => ({
                key: p.path,
                label: p.workshop ? localized(p.workshop, locale) : t.has(`pages.names.${p.path}`) ? t(`pages.names.${p.path}` as "pages.names./") : p.path,
                hint: p.workshop || t.has(`pages.names.${p.path}`) ? p.path : undefined,
                value: p.visitors,
                detail: t("pages.views", { count: p.views, n: n(p.views) }),
              }))}
              locale={locale}
              empty={t("none")}
            />
          </Panel>
          <Panel id="analytics-sources" title={t("sources.title")}>
            <RankList
              rows={stats.referrers.map((r) => ({ key: r.host ?? "direct", label: r.host ?? t("sources.direct"), value: r.visitors }))}
              locale={locale}
              empty={t("none")}
            />
          </Panel>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Panel id="analytics-devices" title={t("devices.title")}>
            <ul className="space-y-3">
              {stats.devices.map((d) => {
                const Icon = deviceIcons[d.key] ?? MonitorIcon
                return (
                  <li key={d.key} className="flex items-center gap-3">
                    <Icon className="text-muted-foreground size-4.5 shrink-0" aria-hidden />
                    <span className="flex-1 text-sm">{t(`devices.${d.key}` as "devices.mobile")}</span>
                    <bdi className="text-sm font-semibold tabular-nums">{formatPercent(share(d.visitors, stats.devices), locale, 0)}</bdi>
                  </li>
                )
              })}
            </ul>
          </Panel>
          <Panel id="analytics-locales" title={t("locales.title")}>
            <RankList
              rows={stats.locales.map((l) => ({ key: l.key, label: t(`locales.${l.key}` as "locales.fa"), value: l.visitors }))}
              locale={locale}
              empty={t("none")}
            />
          </Panel>
          <Panel id="analytics-countries" title={t("countries.title")}>
            <RankList
              rows={stats.countries.map((c) => ({
                key: c.key ?? "unknown",
                label: c.key ? (new Intl.DisplayNames([locale], { type: "region" }).of(c.key) ?? c.key) : t("countries.unknown"),
                value: c.visitors,
              }))}
              locale={locale}
              empty={t("none")}
            />
          </Panel>
        </div>
      </div>
    </>
  )
}

/** A ranked list: each row's label, its visitors and a thin bar of its share of the first. */
function RankList({
  rows,
  locale,
  empty,
}: {
  rows: { key: string; label: string; hint?: string; value: number; detail?: string }[]
  locale: string
  empty: string
}) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>
  const top = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ol className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate" title={r.hint}>
              {r.label}
              {r.hint && (
                <bdi dir="ltr" className="text-muted-foreground ms-2 text-xs">
                  {r.hint}
                </bdi>
              )}
            </span>
            <span className="shrink-0 text-end">
              <bdi className="font-semibold tabular-nums">{formatNumber(r.value, locale)}</bdi>
              {r.detail && <span className="text-muted-foreground ms-1.5 text-xs">{r.detail}</span>}
            </span>
          </div>
          <div aria-hidden className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
            <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.max(3, (r.value / top) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}
