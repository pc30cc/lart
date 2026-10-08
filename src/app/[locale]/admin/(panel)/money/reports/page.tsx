import { BarChart3Icon, DownloadIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge } from "@/components/admin/status-badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getLedgerFilterOptions } from "@/features/money/queries"
import {
  instructorResults,
  partnerStatement,
  profitAndLoss,
  workshopResults,
} from "@/features/money/reports"
import { periodLabel } from "@/features/money/period-label"
import { parseReportParams, periodGroups, reportKinds, type ReportParams } from "@/features/money/schema"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { calendarOf, formatDate, formatNumber, localized } from "@/lib/format"
import { getBrand } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { WorkshopStatusBadge } from "../../workshops/_components/workshop-status"
import { printCss } from "../_components/parts"
import { PrintButton } from "../_components/print-button"
import { RangeFilter } from "../_components/range-filter"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("money.reports")
  return { title: t("title") }
}

type T = Awaited<ReturnType<typeof getTranslations<"money">>>

export default async function ReportsPage({ searchParams }: PageProps<"/[locale]/admin/money/reports">) {
  const { admin } = await requireAdmin()
  const [sp, t, locale] = await Promise.all([searchParams, getTranslations("money"), getLocale()])
  const params = parseReportParams(sp, undefined, calendarOf(locale))
  const [brand, { partners }] = await Promise.all([getBrand(locale), getLedgerFilterOptions()])
  if (params.report === "partner" && !params.partner) {
    params.partner = partners.find((p) => p.id === admin.id)?.id ?? partners[0]?.id ?? null
  }

  const link = (changes: Partial<ReportParams>): Href => {
    const next = { ...params, ...changes }
    const query: Record<string, string> = { report: next.report, from: next.from, to: next.to }
    if (next.report === "pnl") query.group = next.group
    if (next.report === "partner" && next.partner) query.partner = next.partner
    return { pathname: "/admin/money/reports", query }
  }
  const exportQuery = new URLSearchParams({
    locale,
    from: params.from,
    to: params.to,
    group: params.group,
    ...(params.partner ? { partner: params.partner } : {}),
  })
  const rangeText = `${formatDate(`${params.from}T09:00:00Z`, locale, "long")} – ${formatDate(`${params.to}T09:00:00Z`, locale, "long")}`

  return (
    <>
      <style>{printCss}</style>
      <div data-print="hide">
        <PageHeader
          title={t("reports.title")}
          description={t("reports.description")}
          actions={
            <>
              <Button asChild variant="outline" size="lg" className="px-4">
                <a href={`/api/admin/money/export/${params.report}?${exportQuery}`} download>
                  <DownloadIcon />
                  {t("reports.exportCsv")}
                </a>
              </Button>
              <PrintButton label={t("reports.print")} />
            </>
          }
        />

        <nav aria-label={t("reports.title")} className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
          <ul className="flex min-w-max gap-1 border-b">
            {reportKinds.map((kind) => {
              const current = kind === params.report
              return (
                <li key={kind}>
                  <Link
                    href={link({ report: kind })}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "relative inline-flex h-10 items-center px-3 text-sm font-medium transition-colors",
                      "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors",
                      current ? "text-foreground after:bg-primary" : "text-muted-foreground hover:text-foreground after:bg-transparent",
                    )}
                  >
                    {t(`reports.tabs.${kind}`)}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <RangeFilter from={params.from} to={params.to} />
          {params.report === "pnl" && (
            <Pills
              label={t("reports.groupBy")}
              items={periodGroups.map((g) => ({ key: g, label: t(`reports.groups.${g}`), href: link({ group: g }), current: g === params.group }))}
            />
          )}
          {params.report === "partner" && partners.length > 0 && (
            <Pills
              label={t("columns.partner")}
              items={partners.map((p) => ({ key: p.id, label: p.name, href: link({ partner: p.id }), current: p.id === params.partner }))}
            />
          )}
        </div>
      </div>

      <header className="mb-6 hidden space-y-1 print:block" data-print="show">
        <p className="text-sm font-semibold tracking-wide uppercase">{brand}</p>
        <h1 className="text-xl font-semibold">{t(`reports.tabs.${params.report}`)}</h1>
        <p className="text-sm">{rangeText}</p>
      </header>

      {params.report === "pnl" && <PnlReport params={params} t={t} locale={locale} />}
      {params.report === "workshops" && <WorkshopsReport params={params} t={t} locale={locale} />}
      {params.report === "instructors" && <InstructorsReport params={params} t={t} locale={locale} />}
      {params.report === "partner" && <PartnerReport params={params} t={t} locale={locale} />}
    </>
  )
}

type Href = { pathname: string; query: Record<string, string> }

function Pills({ label, items }: { label: string; items: { key: string; label: string; href: Href; current: boolean }[] }) {
  return (
    <div role="group" aria-label={label} className="bg-muted inline-flex w-fit flex-wrap gap-0.5 rounded-lg p-0.5">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.current ? "true" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            item.current ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

// ─── Shared table pieces ──────────────────────────────────────────────────────

const head = "text-muted-foreground h-11 px-4 text-xs font-medium"
const num = "px-4 py-3 text-end tabular-nums"

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="bg-card ring-foreground/8 overflow-hidden rounded-xl shadow-xs ring-1 print:rounded-none">{children}</div>
}

function NoData({ t }: { t: T }) {
  return <EmptyState icon={BarChart3Icon} title={t("reports.empty.title")} description={t("reports.empty.description")} />
}

const figureKeys = ["revenue", "instructorFees", "courseExpenses", "net"] as const
type Figures = Record<(typeof figureKeys)[number], number>

function FigureHeads({ t }: { t: T }) {
  return figureKeys.map((k) => (
    <TableHead key={k} className={cn(head, "text-end", k !== "net" && k !== "revenue" && "hidden sm:table-cell")}>
      {t(`columns.${k}`)}
    </TableHead>
  ))
}

/** `estimated`: the fee includes the projected fee of a workshop not closed yet (marked, see `EstimatedNote`). */
function FigureCells({ row, t, estimated = 0 }: { row: Figures; t: T; estimated?: number }) {
  return figureKeys.map((k) => (
    <TableCell key={k} className={cn(num, k !== "net" && k !== "revenue" && "hidden sm:table-cell", k === "net" && "font-semibold")}>
      <Money value={row[k]} tone={k === "net" ? "signed" : "plain"} />
      {k === "instructorFees" && estimated > 0 && (
        <>
          <sup aria-hidden className="text-muted-foreground ms-0.5">*</sup>
          <span className="sr-only"> ({t("reports.estimated")})</span>
        </>
      )}
    </TableCell>
  ))
}

function EstimatedNote({ t, estimated }: { t: T; estimated: number }) {
  return estimated > 0 ? <p className="text-muted-foreground text-xs text-pretty">{t("reports.estimatedNote")}</p> : null
}

// ─── Reports ──────────────────────────────────────────────────────────────────

async function PnlReport({ params, t, locale }: { params: ReportParams; t: T; locale: string }) {
  const { periods, total } = await profitAndLoss(params, calendarOf(locale))
  const label = (p: string) => periodLabel(p, params.group, locale, (values) => t("reports.quarter", values))
  const cols = ["revenue", "instructorFees", "courseExpenses", "generalExpenses", "net"] as const

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label={t("columns.revenue")} value={total.revenue} />
        <Summary label={t("reports.costs")} value={total.instructorFees + total.courseExpenses + total.generalExpenses} />
        <Summary label={t("columns.net")} value={total.net} signed />
        <Summary
          label={t("reports.margin")}
          text={total.revenue > 0 ? formatNumber(total.net / total.revenue, locale, { style: "percent", maximumFractionDigits: 1 }) : "—"}
        />
      </div>
      <Frame>
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(head, "text-start")}>{t("columns.period")}</TableHead>
              {cols.map((k) => (
                <TableHead key={k} className={cn(head, "text-end", k !== "revenue" && k !== "net" && "hidden md:table-cell")}>
                  {t(`columns.${k}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.map((p) => {
              const quiet = p.revenue === 0 && p.net === 0
              return (
                <TableRow key={p.period} className={cn(quiet && "text-muted-foreground")}>
                  <TableCell className="px-4 py-3 font-medium whitespace-nowrap">{label(p.period)}</TableCell>
                  {cols.map((k) => (
                    <TableCell key={k} className={cn(num, k !== "revenue" && k !== "net" && "hidden md:table-cell", k === "net" && "font-semibold")}>
                      <Money value={p[k]} tone={k === "net" && !quiet ? "signed" : "plain"} />
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableCell className="px-4 py-3 font-semibold">{t("columns.total")}</TableCell>
              {cols.map((k) => (
                <TableCell key={k} className={cn(num, "font-semibold", k !== "revenue" && k !== "net" && "hidden md:table-cell")}>
                  <Money value={total[k]} tone={k === "net" ? "signed" : "plain"} />
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </Frame>
      <p className="text-muted-foreground text-xs text-pretty">{t("reports.pnlNote")}</p>
    </div>
  )
}

function Summary({ label, value, text, signed }: { label: string; value?: number; text?: string; signed?: boolean }) {
  return (
    <div className="bg-card ring-foreground/8 rounded-xl p-4 shadow-xs ring-1">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
        {value !== undefined ? <Money value={value} tone={signed ? "signed" : "plain"} /> : text}
      </p>
    </div>
  )
}

async function WorkshopsReport({ params, t, locale }: { params: ReportParams; t: T; locale: string }) {
  const { workshops, total } = await workshopResults(params)
  if (!workshops.length) return <NoData t={t} />
  return (
    <div className="space-y-4">
      <Frame>
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(head, "text-start")}>{t("columns.workshop")}</TableHead>
              <TableHead className={cn(head, "hidden text-start lg:table-cell")}>{t("columns.status")}</TableHead>
              <TableHead className={cn(head, "hidden text-end md:table-cell")}>{t("columns.participants")}</TableHead>
              <FigureHeads t={t} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {workshops.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="max-w-64 px-4 py-3">
                  <Link href={`/admin/workshops/${w.id}/finances`} className="hover:text-primary block truncate font-medium transition-colors">
                    {localized(w.title, locale)}
                  </Link>
                  <span className="text-muted-foreground block truncate text-xs">
                    {formatDate(w.startsAt, locale, "medium")} · {localized(w.instructor, locale)}
                  </span>
                </TableCell>
                <TableCell className="hidden px-4 py-3 lg:table-cell">
                  {w.status === "cancelled" && w.closed ? (
                    <StatusBadge tone="danger">{t("reports.cancelledClosed")}</StatusBadge>
                  ) : (
                    <WorkshopStatusBadge status={w.status} />
                  )}
                </TableCell>
                <TableCell className={cn(num, "hidden md:table-cell")}>{formatNumber(w.participants, locale)}</TableCell>
                <FigureCells row={w} t={t} estimated={w.estimatedFee} />
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableCell className="px-4 py-3 font-semibold">{t("columns.total")}</TableCell>
              <TableCell className="hidden lg:table-cell" />
              <TableCell className={cn(num, "hidden font-semibold md:table-cell")}>{formatNumber(total.participants, locale)}</TableCell>
              <FigureCells row={total} t={t} estimated={total.estimatedFee} />
            </TableRow>
          </TableFooter>
        </Table>
      </Frame>
      <EstimatedNote t={t} estimated={total.estimatedFee} />
    </div>
  )
}

async function InstructorsReport({ params, t, locale }: { params: ReportParams; t: T; locale: string }) {
  const { instructors, total } = await instructorResults(params)
  if (!instructors.length) return <NoData t={t} />
  return (
    <div className="space-y-4">
      <Frame>
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(head, "text-start")}>{t("columns.instructor")}</TableHead>
              <TableHead className={cn(head, "hidden text-end md:table-cell")}>{t("columns.workshops")}</TableHead>
              <TableHead className={cn(head, "hidden text-end md:table-cell")}>{t("columns.participants")}</TableHead>
              <FigureHeads t={t} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {instructors.map((i) => (
              <TableRow key={i.instructorId}>
                <TableCell className="px-4 py-3 font-medium">
                  <Link href={`/admin/instructors/${i.instructorId}`} className="hover:text-primary transition-colors">
                    {localized(i.instructor, locale)}
                  </Link>
                </TableCell>
                <TableCell className={cn(num, "hidden md:table-cell")}>{formatNumber(i.workshops, locale)}</TableCell>
                <TableCell className={cn(num, "hidden md:table-cell")}>{formatNumber(i.participants, locale)}</TableCell>
                <FigureCells row={i} t={t} estimated={i.estimatedFee} />
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableCell className="px-4 py-3 font-semibold">{t("columns.total")}</TableCell>
              <TableCell className={cn(num, "hidden font-semibold md:table-cell")}>{formatNumber(total.workshops, locale)}</TableCell>
              <TableCell className={cn(num, "hidden font-semibold md:table-cell")}>{formatNumber(total.participants, locale)}</TableCell>
              <FigureCells row={total} t={t} estimated={total.estimatedFee} />
            </TableRow>
          </TableFooter>
        </Table>
      </Frame>
      <EstimatedNote t={t} estimated={total.estimatedFee} />
    </div>
  )
}

async function PartnerReport({ params, t, locale }: { params: ReportParams; t: T; locale: string }) {
  const statement = params.partner ? await partnerStatement(params.partner, params) : null
  if (!statement) return <NoData t={t} />
  const date = (d: string) => formatDate(`${d}T09:00:00Z`, locale, "medium")
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label={t("reports.openingOn", { date: date(params.from) })} value={statement.opening} />
        <Summary label={t("reports.change")} value={statement.closing - statement.opening} signed />
        <Summary label={t("reports.closingOn", { date: date(params.to) })} value={statement.closing} />
      </div>
      <Frame>
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(head, "w-32 text-start")}>{t("columns.date")}</TableHead>
              <TableHead className={cn(head, "text-start")}>{t("columns.entry")}</TableHead>
              <TableHead className={cn(head, "text-end")}>{t("columns.amount")}</TableHead>
              <TableHead className={cn(head, "hidden text-end sm:table-cell")}>{t("columns.balance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="text-muted-foreground">
              <TableCell className="px-4 py-3 whitespace-nowrap">{date(params.from)}</TableCell>
              <TableCell className="px-4 py-3">{t("columns.opening")}</TableCell>
              <TableCell className={num} />
              <TableCell className={cn(num, "hidden sm:table-cell")}>
                <Money value={statement.opening} />
              </TableCell>
            </TableRow>
            {statement.movements.map((m, i) => (
              <TableRow key={`${m.id}-${i}`}>
                <TableCell className="px-4 py-3 whitespace-nowrap tabular-nums">{date(m.occurredOn)}</TableCell>
                <TableCell className="max-w-72 px-4 py-3">
                  <span className="block font-medium">
                    {m.originalKind ? t("kinds.reversalOf", { kind: t(`kinds.${m.originalKind}`) }) : t(`kinds.${m.kind}`)}
                  </span>
                  {(m.description || m.courseTitle) && (
                    <span className="text-muted-foreground block truncate text-xs">
                      {[m.description, m.courseTitle && localized(m.courseTitle, locale)].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </TableCell>
                <TableCell className={cn(num, "font-medium")}>
                  <Money value={m.amount} tone="signed" />
                </TableCell>
                <TableCell className={cn(num, "hidden sm:table-cell")}>
                  <Money value={m.balance} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableCell className="px-4 py-3 whitespace-nowrap">{date(params.to)}</TableCell>
              <TableCell className="px-4 py-3 font-semibold">{t("columns.closing")}</TableCell>
              <TableCell className={num} />
              <TableCell className={cn(num, "hidden font-semibold sm:table-cell")}>
                <Money value={statement.closing} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Frame>
      <p className="text-muted-foreground text-xs text-pretty">{t("reports.partnerNote")}</p>
    </div>
  )
}
