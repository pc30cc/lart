"use client"

import { useLocale, useTranslations } from "next-intl"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  LabelList,
  Line,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
  type BaseTickContentProps,
} from "recharts"

import { Money } from "@/components/admin/money"
import { PersonAvatar } from "@/components/admin/person-avatar"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isRtl } from "@/i18n/routing"
import { formatNumber, formatPercent, intlLocale } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Panel } from "./panel"

/*
 * The dashboard charts (Recharts through ui/chart). Colours are the chart-1..5
 * tokens, assigned in order. The SVG is always laid out left-to-right (SVG
 * text anchors flip under dir="rtl"), and for Persian the axes are mirrored
 * instead: time runs right to left and the value axis sits on the right.
 * Tooltips and every text outside the SVG follow the page direction. Each
 * chart has a screen-reader table with every value.
 */

export type MonthPoint = { key: string; label: string; full: string; revenue: number; expenses: number; net: number }
export type SeatPoint = { id: string; label: string; title: string; date: string; registered: number; min: number; max: number; upcoming: boolean }
export type RankPoint = { id: string; name: string; detail: string; value: number }
export type PartnerSlice = { id: string; name: string; shareBp: number; capital: number; active: boolean; photoUrl?: string | null }

const slot = (n: number) => `var(--chart-${Math.min(Math.max(n, 1), 5)})`
const cursor = { fill: "var(--muted)", fillOpacity: 0.6 }

function useDirection() {
  const locale = useLocale()
  return { locale, rtl: isRtl(locale) }
}

/** Short lira amounts for axis ticks: "₺12.5K", "12,5 B ₺", "۱۲٫۵ هزار ₺". */
function compactLira(kurus: number, locale: string) {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: "TRY",
    currencyDisplay: "narrowSymbol",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(kurus / 100)
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

type TipRow = { label: string; value: string; color?: string }

/** Tooltip card: the value leads, the series name follows, keyed by a short line of its colour. */
function TipBox({ title, subtitle, rows }: { title: string; subtitle?: string; rows: TipRow[] }) {
  const { rtl } = useDirection()
  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="bg-popover text-popover-foreground ring-foreground/10 grid max-w-64 min-w-44 gap-2 rounded-lg px-3 py-2.5 text-xs shadow-lg ring-1"
    >
      <div>
        <p className="font-medium text-pretty">{title}</p>
        {subtitle && <p className="text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="grid gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            {row.color && <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />}
            <span className="text-muted-foreground flex-1">{row.label}</span>
            <bdi className="text-foreground font-semibold tabular-nums">{row.value}</bdi>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The values of a chart for screen readers (the chart itself is visual). The
 * sr-only box is a div: a table ignores the 1px width and would widen the page.
 */
function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={j}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Swatch({ color, shape = "square" }: { color: string; shape?: "square" | "line" | "track" }) {
  return (
    <span
      aria-hidden
      className={cn("shrink-0", shape === "line" ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[3px]", shape === "track" && "opacity-25")}
      style={{ backgroundColor: color }}
    />
  )
}

// ─── Revenue, expenses and net profit per month ───────────────────────────────

export function RevenueChart({ data }: { data: MonthPoint[] }) {
  const t = useTranslations("dashboard.revenue")
  const { locale, rtl } = useDirection()
  const keys = ["revenue", "expenses", "net"] as const
  const config = {
    revenue: { label: t("revenue"), color: slot(1) },
    expenses: { label: t("expenses"), color: slot(2) },
    net: { label: t("net"), color: slot(3) },
  } satisfies ChartConfig
  const lira = (v: number) => formatLira(v, locale)
  const sum = (k: (typeof keys)[number]) => data.reduce((s, m) => s + m[k], 0)
  const negative = data.some((m) => m.net < 0 || m.revenue < 0)

  return (
    <div className="space-y-5">
      <ul className="flex flex-wrap gap-x-6 gap-y-3 sm:gap-x-8" aria-label={t("totals")}>
        {keys.map((k) => (
          <li key={k} className="min-w-0">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Swatch color={config[k].color} shape={k === "net" ? "line" : "square"} />
              {config[k].label}
            </span>
            <Money
              value={sum(k)}
              className={cn("mt-1 block text-base font-semibold tracking-tight proportional-nums sm:text-lg", k === "net" && sum(k) < 0 && "text-destructive")}
            />
          </li>
        ))}
      </ul>

      <ChartContainer config={config} dir="ltr" className="aspect-auto h-64 w-full sm:h-72">
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barGap={3} barCategoryGap="26%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" reversed={rtl} tickLine={false} axisLine={false} tickMargin={10} minTickGap={8} />
          <YAxis
            orientation={rtl ? "right" : "left"}
            width={rtl ? 84 : 64}
            tickLine={false}
            axisLine={false}
            tickCount={5}
            tickFormatter={(v: number) => compactLira(v, locale)}
          />
          {negative && <ReferenceLine y={0} stroke="var(--border)" />}
          <ChartTooltip
            cursor={cursor}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as MonthPoint | undefined
              if (!active || !row) return null
              return (
                <TipBox
                  title={row.full}
                  rows={keys.map((k) => ({ label: config[k].label, value: lira(row[k]), color: config[k].color }))}
                />
              )
            }}
          />
          <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={900} />
          <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={900} animationBegin={120} />
          <Line
            dataKey="net"
            type="monotone"
            stroke="var(--color-net)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 5, fill: "var(--color-net)", stroke: "var(--card)", strokeWidth: 2 }}
            animationDuration={1100}
            animationBegin={250}
          />
        </ComposedChart>
      </ChartContainer>

      <ChartTable
        caption={t("tableCaption")}
        head={[t("month"), config.revenue.label, config.expenses.label, config.net.label]}
        rows={data.map((m) => [m.full, lira(m.revenue), lira(m.expenses), lira(m.net)])}
      />
    </div>
  )
}

// ─── Registrations and fill rate per workshop ─────────────────────────────────

export function SeatsChart({ data }: { data: SeatPoint[] }) {
  const t = useTranslations("dashboard.seats")
  const { locale, rtl } = useDirection()
  const config = { registered: { label: t("registered"), color: slot(1) } } satisfies ChartConfig
  // Not `fill`: Recharts reads a data row's `fill` (and `stroke`) as its colour.
  const rows = data.map((w) => ({ ...w, rate: w.max > 0 ? w.registered / w.max : 0 }))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const held = rows.filter((r) => !r.upcoming)
  const pct = (v: number) => formatPercent(v, locale, 0)
  const num = (v: number) => formatNumber(v, locale)

  return (
    <div className="space-y-4">
      <ul className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <li className="flex items-center gap-1.5">
          <Swatch color={config.registered.color} />
          {t("registered")}
        </li>
        <li className="flex items-center gap-1.5">
          <Swatch color={config.registered.color} shape="track" />
          {t("capacity")}
        </li>
        {held.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="bg-muted ring-border size-2.5 rounded-[3px] ring-1" />
            {t("heldArea")}
          </li>
        )}
      </ul>

      <ChartContainer config={config} dir="ltr" className="aspect-auto h-60 w-full">
        <BarChart data={rows} margin={{ top: 22, right: 4, bottom: 0, left: 4 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} />
          {/* A hidden second axis over the same workshops, so the capacity track and the registrations overlap like a meter. */}
          <XAxis xAxisId="track" dataKey="id" hide reversed={rtl} />
          <XAxis
            dataKey="id"
            reversed={rtl}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={6}
            tickFormatter={(id: string) => byId.get(id)?.label ?? ""}
          />
          <YAxis
            orientation={rtl ? "right" : "left"}
            width={32}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => num(v)}
          />
          {held.length > 0 && (
            <ReferenceArea x1={held[0].id} x2={held[held.length - 1].id} fill="var(--muted)" fillOpacity={0.7} />
          )}
          <ChartTooltip
            cursor={false}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as (typeof rows)[number] | undefined
              if (!active || !row) return null
              return (
                <TipBox
                  title={row.title}
                  subtitle={`${row.date} · ${row.upcoming ? t("upcoming") : t("held")}`}
                  rows={[
                    { label: t("registered"), value: num(row.registered), color: config.registered.color },
                    { label: t("capacity"), value: num(row.max) },
                    { label: t("minimum"), value: num(row.min) },
                    { label: t("fill"), value: pct(row.rate) },
                  ]}
                />
              )
            }}
          />
          <Bar
            xAxisId="track"
            dataKey="max"
            fill="var(--color-registered)"
            fillOpacity={0.16}
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            animationDuration={700}
          >
            <LabelList
              dataKey="rate"
              position="top"
              offset={6}
              fontSize={11}
              fill="var(--muted-foreground)"
              className="fill-muted-foreground"
              formatter={(v) => pct(Number(v))}
            />
          </Bar>
          <Bar
            dataKey="registered"
            fill="var(--color-registered)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            animationDuration={1000}
            animationBegin={200}
          />
        </BarChart>
      </ChartContainer>

      <ChartTable
        caption={t("tableCaption")}
        head={[t("workshop"), t("date"), t("registered"), t("capacity"), t("fill")]}
        rows={rows.map((r) => [r.title, r.date, num(r.registered), num(r.max), pct(r.rate)])}
      />
    </div>
  )
}

// ─── Profit per workshop and per instructor ───────────────────────────────────

function RankChart({ rows, label, caption, nameHead }: { rows: RankPoint[]; label: string; caption: string; nameHead: string }) {
  const { locale, rtl } = useDirection()
  const config = { value: { label, color: slot(1) } } satisfies ChartConfig
  const byId = new Map(rows.map((r) => [r.id, r]))
  const values = rows.map((r) => r.value)
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  // Room beyond the longest bars for their amounts.
  const room = (hi - lo || 1) * 0.34
  const domain: [number, number] = [lo < 0 ? lo - room : 0, hi > 0 ? hi + room : 0]
  const lira = (v: number) => formatLira(v, locale)

  return (
    <>
      <ChartContainer config={config} dir="ltr" className="aspect-auto w-full" style={{ height: rows.length * 38 + 8 }}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 4, bottom: 4, left: 4 }} barCategoryGap={10}>
          <XAxis type="number" hide domain={domain} reversed={rtl} />
          <YAxis
            type="category"
            dataKey="id"
            orientation={rtl ? "right" : "left"}
            width={132}
            interval={0}
            tickLine={false}
            axisLine={false}
            tick={(p: BaseTickContentProps) => (
              <text x={p.x} y={p.y} dy={4} textAnchor={p.textAnchor}>
                {truncate(byId.get(String(p.payload.value))?.name ?? "", 19)}
              </text>
            )}
          />
          {lo < 0 && <ReferenceLine x={0} stroke="var(--border)" />}
          <ChartTooltip
            cursor={cursor}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as RankPoint | undefined
              if (!active || !row) return null
              return <TipBox title={row.name} subtitle={row.detail} rows={[{ label, value: lira(row.value), color: config.value.color }]} />
            }}
          />
          {/* minPointSize: a workshop that broke even (e.g. cancelled, nothing spent) still gets its "₺0". */}
          <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={16} minPointSize={2} animationDuration={900}>
            <LabelList
              dataKey="value"
              content={(p) => {
                const box = p.viewBox as { x: number; y: number; width: number; height: number } | undefined
                if (!box) return null
                const value = Number(p.value)
                // The bar's tip: on the right for a profit (left for a loss), mirrored in Persian.
                const tipRight = value >= 0 !== rtl
                const x = tipRight ? Math.max(box.x, box.x + box.width) + 6 : Math.min(box.x, box.x + box.width) - 6
                return (
                  <text x={x} y={box.y + box.height / 2} dy={4} textAnchor={tipRight ? "start" : "end"} className="fill-muted-foreground text-xs">
                    {lira(value)}
                  </text>
                )
              }}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
      <ChartTable caption={caption} head={[nameHead, label]} rows={rows.map((r) => [`${r.name} (${r.detail})`, lira(r.value)])} />
    </>
  )
}

/** One card, two views: by workshop and by instructor. */
export function ProfitPanel({
  workshops,
  instructors,
  delay,
  className,
}: {
  workshops: RankPoint[]
  instructors: RankPoint[]
  delay?: number
  className?: string
}) {
  const t = useTranslations("dashboard.profit")
  return (
    <Tabs defaultValue="workshops" className={cn("gap-0", className)}>
      <Panel
        id="dashboard-profit"
        title={t("title")}
        description={t("description")}
        delay={delay}
        className="h-full"
        action={
          <TabsList aria-label={t("view")}>
            <TabsTrigger value="workshops" className="px-2.5">
              {t("byWorkshop")}
            </TabsTrigger>
            <TabsTrigger value="instructors" className="px-2.5">
              {t("byInstructor")}
            </TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="workshops" className="animate-in fade-in duration-300">
          <RankChart rows={workshops} label={t("net")} caption={t("byWorkshop")} nameHead={t("workshop")} />
        </TabsContent>
        <TabsContent value="instructors" className="animate-in fade-in duration-300">
          <RankChart rows={instructors} label={t("net")} caption={t("byInstructor")} nameHead={t("instructor")} />
        </TabsContent>
      </Panel>
    </Tabs>
  )
}

// ─── Partners: share and capital ──────────────────────────────────────────────

export function PartnersChart({ partners }: { partners: PartnerSlice[] }) {
  const t = useTranslations("dashboard.partners")
  const { locale, rtl } = useDirection()
  // Colours follow the partner (oldest first), never their rank.
  const slices = partners.filter((p) => p.shareBp > 0).map((p, i) => ({ ...p, key: `p${i}`, color: slot(i + 1) }))
  const colorOf = new Map(slices.map((s) => [s.id, s.color]))
  const config = Object.fromEntries(slices.map((s) => [s.key, { label: s.name, color: s.color }])) satisfies ChartConfig
  const totalCapital = partners.reduce((s, p) => s + p.capital, 0)
  const share = (bp: number) => formatPercent(bp / 10000, locale)

  return (
    <div className="flex flex-col gap-5">
      {slices.length > 0 && (
        <ChartContainer config={config} dir="ltr" className="mx-auto aspect-square h-48">
          <PieChart>
            <ChartTooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (typeof slices)[number] | undefined
                if (!active || !row) return null
                return (
                  <TipBox
                    title={row.name}
                    rows={[
                      { label: t("share"), value: share(row.shareBp), color: row.color },
                      { label: t("capital"), value: formatLira(row.capital, locale) },
                    ]}
                  />
                )
              }}
            />
            <Pie
              data={slices}
              dataKey="shareBp"
              nameKey="key"
              innerRadius="70%"
              outerRadius="100%"
              startAngle={90}
              endAngle={rtl ? 450 : -270}
              cornerRadius={slices.length > 1 ? 4 : 0}
              stroke="var(--card)"
              strokeWidth={2}
              animationDuration={900}
            >
              {slices.map((s) => (
                <Cell key={s.key} fill={`var(--color-${s.key})`} />
              ))}
              <Label
                content={({ viewBox }) => {
                  const { cx, cy } = (viewBox ?? {}) as { cx?: number; cy?: number }
                  if (cx == null || cy == null) return null
                  return (
                    <text x={cx} y={cy} textAnchor="middle">
                      <tspan x={cx} dy="-0.1em" className="fill-foreground text-base font-semibold">
                        {formatLira(totalCapital, locale)}
                      </tspan>
                      <tspan x={cx} dy="1.6em" className="fill-muted-foreground text-xs">
                        {t("totalCapital")}
                      </tspan>
                    </text>
                  )
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      )}

      <ul className="divide-y" aria-label={t("listLabel")}>
        {partners.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            {/* The dot on the photo is the chart's colour for this partner (the legend). */}
            <span className="relative shrink-0">
              <PersonAvatar name={p.name} url={p.photoUrl} className="size-8 text-xs" />
              <span
                aria-hidden
                className="ring-card absolute -end-0.5 -bottom-0.5 size-3 rounded-full ring-2"
                style={{ backgroundColor: colorOf.get(p.id) ?? "var(--muted-foreground)" }}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="text-muted-foreground block text-xs">
                {p.active ? t("shareOf", { share: share(p.shareBp) }) : t("former")}
              </span>
            </span>
            <span className="text-end">
              <Money value={p.capital} className={cn("block text-sm font-semibold", p.capital < 0 && "text-destructive")} />
              <span className="text-muted-foreground block text-xs">{t("capital")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
