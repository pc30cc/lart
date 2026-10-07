import {
  AlarmClockIcon,
  ArrowRightIcon,
  BellRingIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  CheckIcon,
  ChartColumnIcon,
  FileSignatureIcon,
  FileTextIcon,
  GaugeIcon,
  HandshakeIcon,
  LockIcon,
  PiggyBankIcon,
  SparklesIcon,
  TagsIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { getLocale } from "next-intl/server"

import { FillMeter, WorkshopStatusBadge } from "@/app/[locale]/admin/(panel)/workshops/_components/workshop-status"
import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Link } from "@/i18n/navigation"
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatTimeRange,
  formatWeekday,
  intlLocale,
  localized,
  TIME_ZONE,
  zonedParts,
} from "@/lib/format"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"
import { getDashboard, type Dashboard, type UpcomingWorkshop } from "../queries"
import { PartnersChart, ProfitPanel, RevenueChart, SeatsChart, type MonthPoint, type RankPoint, type SeatPoint } from "./charts"
import { enter, Panel } from "./panel"

/** The dashboard below the page header (streams in; `DashboardSkeleton` shows meanwhile). */
export async function DashboardContent() {
  const [data, locale] = await Promise.all([getDashboard(), getLocale()])
  if (data.blank) return <GettingStarted setup={data.setup} />

  const monthName = (month: string, style: "short" | "long") =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      month: style,
      ...(style === "long" ? { year: "numeric" } : {}),
      timeZone: "UTC",
    }).format(new Date(`${month}T12:00:00Z`))
  const months: MonthPoint[] = data.months.map((m) => ({ ...m, key: m.month, label: monthName(m.month, "short"), full: monthName(m.month, "long") }))
  const dayMonth = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: TIME_ZONE })
  const seats: SeatPoint[] = data.seats.map((w) => ({
    id: w.id,
    label: dayMonth.format(w.startsAt),
    title: localized(w.title, locale),
    date: formatDate(w.startsAt, locale, "full"),
    registered: w.registered,
    min: w.minCapacity,
    max: w.maxCapacity,
    upcoming: w.upcoming,
  }))

  return (
    <div className="space-y-6">
      {data.fresh && <GettingStarted setup={data.setup} />}
      <Attention attention={data.attention} />
      <Kpis kpis={data.kpis} year={data.year} />

      <div className="grid gap-6 xl:grid-cols-3">
        <RevenuePanel months={months} className="xl:col-span-2" />
        <PartnersPanel partners={data.partners} />
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <UpcomingPanel rows={data.upcoming} today={data.today} className="lg:col-span-7" />
        <SeatsPanel seats={seats} className="lg:col-span-5" />
      </div>

      <ProfitSection profit={data.profit} />
    </div>
  )
}

// ─── First steps (fresh install) ──────────────────────────────────────────────

function GettingStarted({ setup }: { setup: Dashboard["setup"] }) {
  const t = useTranslations("dashboard.setup")
  const locale = useLocale()
  const steps: { key: string; done: boolean; href: string; icon: LucideIcon }[] = [
    { key: "category", done: setup.categories > 0, href: "/admin/categories/new", icon: TagsIcon },
    { key: "instructor", done: setup.instructors > 0, href: "/admin/instructors/new", icon: UsersRoundIcon },
    { key: "contract", done: setup.contract, href: "/admin/templates", icon: FileTextIcon },
    { key: "workshop", done: setup.workshops > 0, href: "/admin/workshops/new", icon: CalendarPlusIcon },
    { key: "capital", done: setup.ledger, href: "/admin/money", icon: WalletIcon },
  ]
  const next = steps.find((s) => !s.done)
  const done = steps.filter((s) => s.done).length

  return (
    <section
      aria-labelledby="dashboard-setup"
      className={cn(
        "from-primary/12 via-primary/4 ring-primary/15 relative overflow-hidden rounded-2xl bg-linear-to-br to-transparent p-5 shadow-xs ring-1 md:p-8",
        enter,
      )}
    >
      <SparklesIcon aria-hidden className="text-primary/10 absolute -end-8 -top-8 size-44 rtl:-scale-x-100" />
      <div className="relative max-w-2xl space-y-2">
        <p className="text-primary text-sm font-medium">
          {t("progress", { done: formatNumber(done, locale), total: formatNumber(steps.length, locale) })}
        </p>
        <h2 id="dashboard-setup" className="text-xl font-semibold tracking-tight text-balance md:text-2xl">
          {t("title")}
        </h2>
        <p className="text-muted-foreground text-pretty">{t("description")}</p>
      </div>
      <Button asChild size="lg" className="relative mt-5 px-4">
        <Link href="/admin/workshops/new">
          <CalendarPlusIcon />
          {t("cta")}
        </Link>
      </Button>

      <ol className="bg-card/85 ring-foreground/8 relative mt-6 divide-y rounded-xl shadow-xs ring-1 backdrop-blur">
        {steps.map((step, i) => (
          <li key={step.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                step.done && "bg-success/15 text-success",
                !step.done && step === next && "bg-primary text-primary-foreground",
                !step.done && step !== next && "bg-muted text-muted-foreground",
              )}
            >
              {step.done ? <CheckIcon aria-hidden className="size-4" /> : formatNumber(i + 1, locale)}
            </span>
            <div className="min-w-0 flex-1 basis-56">
              <p className={cn("font-medium", step.done && "text-muted-foreground")}>
                {t(`steps.${step.key}.title`)}
                {step.done && <span className="sr-only"> ({t("done")})</span>}
              </p>
              <p className="text-muted-foreground text-sm text-pretty">{t(`steps.${step.key}.description`)}</p>
            </div>
            {step.done ? (
              <span aria-hidden className="text-success text-sm font-medium">
                {t("done")}
              </span>
            ) : (
              <Button asChild variant={step === next ? "default" : "outline"} size="sm">
                <Link href={step.href}>
                  <step.icon />
                  {t(`steps.${step.key}.action`)}
                </Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

// ─── Needs attention ──────────────────────────────────────────────────────────

function Attention({ attention }: { attention: Dashboard["attention"] }) {
  const t = useTranslations("dashboard.attention")
  const items = [
    { key: "decisions", count: attention.decisionsDue, href: "/admin/workshops?view=published", icon: AlarmClockIcon },
    { key: "signatures", count: attention.awaitingSignature, href: "/admin/workshops?view=awaiting_signature", icon: FileSignatureIcon },
    { key: "toClose", count: attention.toClose, href: "/admin/money", icon: LockIcon },
  ].filter((i) => i.count > 0)
  if (!items.length) return null

  return (
    <section
      aria-labelledby="dashboard-attention"
      className={cn("bg-warning/6 ring-warning/20 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl px-4 py-3 ring-1", enter)}
    >
      <h2 id="dashboard-attention" className="flex items-center gap-2 text-sm font-semibold">
        <span className="bg-warning/15 text-warning flex size-7 items-center justify-center rounded-lg">
          <BellRingIcon aria-hidden className="size-4" />
        </span>
        {t("title")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="group bg-card ring-foreground/10 hover:ring-primary/35 hover:text-primary inline-flex min-h-9 items-center gap-2 rounded-full px-3.5 text-sm shadow-xs ring-1 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <item.icon aria-hidden className="text-warning size-4" />
              {t(item.key, { count: item.count })}
              <ArrowRightIcon aria-hidden className="size-3.5 opacity-60 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── Key figures ──────────────────────────────────────────────────────────────

function Kpi({
  icon: Icon,
  label,
  value,
  footer,
  href,
  hero,
  delay = 0,
  className,
}: {
  icon: LucideIcon
  label: string
  value: React.ReactNode
  footer: React.ReactNode
  href: string
  hero?: boolean
  delay?: number
  className?: string
}) {
  return (
    <Link
      href={href}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      className={cn(
        "group relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl p-4 shadow-xs ring-1 transition-[box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:shadow-md md:p-5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        hero ? "from-primary/14 to-primary/3 ring-primary/18 bg-linear-to-br" : "bg-card ring-foreground/8 hover:ring-primary/25",
        enter,
        className,
      )}
    >
      {hero && <Icon aria-hidden className="text-primary/8 absolute -end-5 -bottom-7 size-32 rtl:-scale-x-100" />}
      <span className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm font-medium">{label}</span>
        <span
          aria-hidden
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
            hero ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground group-hover:text-primary transition-colors",
          )}
        >
          <Icon />
        </span>
      </span>
      <span className="relative text-2xl font-semibold tracking-tight md:text-[1.75rem]">{value}</span>
      <span className="text-muted-foreground relative mt-auto text-xs text-pretty">{footer}</span>
    </Link>
  )
}

function Kpis({ kpis, year }: { kpis: Dashboard["kpis"]; year: number }) {
  const t = useTranslations("dashboard.kpi")
  const locale = useLocale()
  const num = (n: number) => formatNumber(n, locale)
  const change = kpis.revenueChange

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Kpi
        hero
        icon={WalletIcon}
        href="/admin/money"
        label={t("wallet")}
        className="sm:col-span-2 xl:col-span-1"
        value={<Money value={kpis.wallet} className={cn("proportional-nums", kpis.wallet < 0 && "text-destructive")} />}
        footer={kpis.wallet < 0 ? t("walletNegative") : t("walletHint")}
      />
      <Kpi
        icon={ChartColumnIcon}
        href="/admin/money/reports"
        label={t("revenue")}
        delay={60}
        value={<Money value={kpis.revenueThisMonth} className="proportional-nums" />}
        footer={
          change == null ? (
            kpis.revenueLastMonth === 0 ? (
              t("noRevenueLastMonth")
            ) : (
              t("lastMonth", { amount: formatLira(kpis.revenueLastMonth, locale) })
            )
          ) : (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
                  change > 0 && "bg-success/10 text-success",
                  change < 0 && "bg-destructive/10 text-destructive",
                  change === 0 && "bg-muted",
                )}
              >
                {change > 0 && <TrendingUpIcon aria-hidden className="size-3.5 rtl:-scale-x-100" />}
                {change < 0 && <TrendingDownIcon aria-hidden className="size-3.5 rtl:-scale-x-100" />}
                {formatPercent(Math.abs(change), locale, 0)}
              </span>
              {change > 0 ? t("moreThanLastMonth") : change < 0 ? t("lessThanLastMonth") : t("sameAsLastMonth")}
            </span>
          )
        }
      />
      <Kpi
        icon={PiggyBankIcon}
        href="/admin/money/reports"
        label={t("net", { year: formatNumber(year, locale, { useGrouping: false }) })}
        delay={120}
        value={<Money value={kpis.netThisYear} className={cn("proportional-nums", kpis.netThisYear < 0 && "text-destructive")} />}
        footer={t("netHint")}
      />
      <Kpi
        icon={CalendarDaysIcon}
        href="/admin/workshops"
        label={t("upcoming")}
        delay={180}
        value={num(kpis.upcoming)}
        footer={
          kpis.upcomingSeats > 0
            ? t("upcomingSeats", { taken: num(kpis.upcomingTaken), seats: num(kpis.upcomingSeats) })
            : kpis.upcoming > 0
              ? t("upcomingNotOpen")
              : t("upcomingNone")
        }
      />
      <Kpi
        icon={GaugeIcon}
        href="/admin/workshops?view=closed"
        label={t("fill")}
        delay={240}
        value={kpis.fillRate == null ? "—" : formatPercent(kpis.fillRate, locale, 0)}
        footer={
          kpis.fillRate == null
            ? t("fillNone")
            : t("fillHint", { taken: num(kpis.heldTaken), seats: num(kpis.heldSeats), count: kpis.held })
        }
      />
    </div>
  )
}

// ─── Panels ───────────────────────────────────────────────────────────────────

function ViewAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -me-2">
      <Link href={href}>
        {children}
        <ArrowRightIcon className="rtl:rotate-180" />
      </Link>
    </Button>
  )
}

const quiet = "border-0 bg-transparent py-10"

function RevenuePanel({ months, className }: { months: MonthPoint[]; className?: string }) {
  const t = useTranslations("dashboard.revenue")
  const empty = months.every((m) => m.revenue === 0 && m.expenses === 0)
  return (
    <Panel
      id="dashboard-revenue"
      title={t("title")}
      description={t("description")}
      delay={120}
      className={className}
      action={<ViewAll href="/admin/money/reports">{t("report")}</ViewAll>}
    >
      {empty ? (
        <EmptyState icon={ChartColumnIcon} title={t("empty.title")} description={t("empty.description")} className={quiet} />
      ) : (
        <RevenueChart data={months} />
      )}
    </Panel>
  )
}

function PartnersPanel({ partners }: { partners: Dashboard["partners"] }) {
  const t = useTranslations("dashboard.partners")
  const locale = useLocale()
  const sharing = partners.filter((p) => p.active)
  const shares = sharing.reduce((s, p) => s + p.shareBp, 0)
  return (
    <Panel
      id="dashboard-partners"
      title={t("title")}
      description={t("description")}
      delay={180}
      action={<ViewAll href="/admin/money/partners">{t("manage")}</ViewAll>}
    >
      {shares === 0 ? (
        <EmptyState
          icon={HandshakeIcon}
          title={t("empty.title")}
          description={t("empty.description")}
          className={quiet}
          action={
            <Button asChild variant="outline">
              <Link href="/admin/money/partners">{t("empty.action")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          {shares !== 10000 && (
            <p className="bg-warning/8 text-warning mb-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t("sharesOff", { total: formatPercent(shares / 10000, locale) })}
            </p>
          )}
          <PartnersChart partners={partners} />
        </>
      )}
    </Panel>
  )
}

function UpcomingPanel({ rows, today, className }: { rows: UpcomingWorkshop[]; today: string; className?: string }) {
  const t = useTranslations("dashboard.upcoming")
  return (
    <Panel
      id="dashboard-upcoming"
      title={t("title")}
      description={t("description")}
      delay={240}
      className={className}
      action={rows.length > 0 && <ViewAll href="/admin/workshops">{t("all")}</ViewAll>}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarDaysIcon}
          title={t("empty.title")}
          description={t("empty.description")}
          className={quiet}
          action={
            <Button asChild>
              <Link href="/admin/workshops/new">
                <CalendarPlusIcon />
                {t("empty.action")}
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="-mx-2 -my-1 divide-y">
          {rows.map((w) => (
            <UpcomingRow key={w.id} w={w} today={today} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** The Istanbul date one day after `date` ("YYYY-MM-DD"). */
const nextDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

function UpcomingRow({ w, today }: { w: UpcomingWorkshop; today: string }) {
  const t = useTranslations("dashboard.upcoming")
  const locale = useLocale()
  const num = (n: number) => formatNumber(n, locale)
  const date = zonedParts(w.startsAt).date
  const day = date === today ? t("today") : date === nextDay(today) ? t("tomorrow") : formatWeekday(w.startsAt, locale)
  const parts = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(intlLocale(locale), { timeZone: TIME_ZONE, ...options }).format(w.startsAt)
  const alert = w.alert
  const payment = w.payment

  return (
    <li>
      <Link
        href={`/admin/workshops/${w.id}`}
        className="group hover:bg-muted/50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-xl px-2 py-3 transition-colors sm:grid-cols-[auto_minmax(0,1fr)_9.5rem]"
      >
        <span
          aria-hidden
          className={cn(
            "row-span-2 flex w-13 flex-col items-center justify-center self-start rounded-xl py-1.5 text-center ring-1 sm:row-span-1 sm:self-center",
            date === today ? "bg-primary/10 text-primary ring-primary/20" : "bg-muted/60 ring-foreground/5",
          )}
        >
          <span className="text-[0.68rem] leading-tight font-medium uppercase opacity-80">{parts({ month: "short" })}</span>
          <span className="text-lg leading-tight font-semibold">{parts({ day: "numeric" })}</span>
        </span>

        <span className="min-w-0 space-y-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="group-hover:text-primary truncate font-medium transition-colors">{localized(w.title, locale)}</span>
            <WorkshopStatusBadge status={w.status} className="h-5 px-2" />
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            <span className="sr-only">{formatDate(w.startsAt, locale, "full")} · </span>
            <span aria-hidden>{w.running ? t("now") : day} · </span>
            <bdi>{formatTimeRange(w.startsAt, w.endsAt, locale)}</bdi> · {localized(w.instructor, locale)}
          </span>
          {alert && (
            <span
              className={cn(
                "flex items-start gap-1.5 text-xs font-medium",
                alert.kind === "decisionDue" ? "text-destructive" : alert.kind === "awaitingSignature" ? "text-warning" : "text-info",
              )}
            >
              {alert.kind === "decisionDue" && <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />}
              {alert.kind === "decisionSoon" && <AlarmClockIcon aria-hidden className="mt-px size-3.5 shrink-0" />}
              {alert.kind === "awaitingSignature" && <FileSignatureIcon aria-hidden className="mt-px size-3.5 shrink-0" />}
              <span>
                {alert.kind === "awaitingSignature" && t("alerts.awaitingSignature")}
                {alert.kind === "decisionDue" && t("alerts.decisionDue")}
                {alert.kind === "decisionSoon" && t("alerts.decisionSoon", { when: formatDateTime(alert.at, locale, "medium") })}
                {alert.kind !== "awaitingSignature" &&
                  ` · ${alert.missing > 0 ? t("alerts.missing", { count: alert.missing }) : t("alerts.minimumReached")}`}
              </span>
            </span>
          )}
        </span>

        <span className="col-start-2 sm:col-start-3 sm:row-start-1">
          {w.status === "awaiting_signature" ? (
            <span className="text-muted-foreground text-xs">{t("notOpen")}</span>
          ) : (
            <>
              <FillMeter
                registered={w.registered}
                min={w.minCapacity}
                max={w.maxCapacity}
                label={t("seats", { taken: num(w.registered), max: num(w.maxCapacity) })}
              />
              {payment && (
                <span className="text-muted-foreground mt-1 block text-xs">
                  {payment.kind === "free" ? t("free") : t("paid", { count: payment.count })}
                </span>
              )}
              {w.finalParticipants !== null && (
                <span className="text-muted-foreground mt-1 block text-xs">{t("final", { count: w.finalParticipants })}</span>
              )}
            </>
          )}
        </span>
      </Link>
    </li>
  )
}

function SeatsPanel({ seats, className }: { seats: SeatPoint[]; className?: string }) {
  const t = useTranslations("dashboard.seats")
  return (
    <Panel id="dashboard-seats" title={t("title")} description={t("description")} delay={300} className={className}>
      {seats.length === 0 ? (
        <EmptyState icon={UsersRoundIcon} title={t("empty.title")} description={t("empty.description")} className={quiet} />
      ) : (
        <SeatsChart data={seats} />
      )}
    </Panel>
  )
}

function ProfitSection({ profit }: { profit: Dashboard["profit"] }) {
  const t = useTranslations("dashboard.profit")
  const locale = useLocale()
  if (profit.workshops.length === 0) {
    return (
      <Panel id="dashboard-profit" title={t("title")} description={t("description")} delay={360}>
        <EmptyState icon={PiggyBankIcon} title={t("empty.title")} description={t("empty.description")} className={quiet} />
      </Panel>
    )
  }
  const workshops: RankPoint[] = profit.workshops.map((w) => ({
    id: w.id,
    name: localized(w.title, locale),
    detail: `${formatDate(w.startsAt, locale, "medium")} · ${localized(w.instructor, locale)}`,
    value: w.netProfit,
  }))
  const instructors: RankPoint[] = profit.instructors.map((i) => ({
    id: i.id,
    name: localized(i.name, locale),
    detail: t("workshops", { count: i.workshops }),
    value: i.netProfit,
  }))
  return <ProfitPanel workshops={workshops} instructors={instructors} delay={360} />
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/** Shown while the dashboard's figures load: the same layout, calm and still. */
export function DashboardSkeleton() {
  const t = useTranslations("dashboard")
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className={cn("h-34 rounded-2xl", i === 0 && "sm:col-span-2 xl:col-span-1")} />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-104 rounded-2xl xl:col-span-2" />
        <Skeleton className="h-104 rounded-2xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <Skeleton className="h-88 rounded-2xl lg:col-span-7" />
        <Skeleton className="h-88 rounded-2xl lg:col-span-5" />
      </div>
    </div>
  )
}
