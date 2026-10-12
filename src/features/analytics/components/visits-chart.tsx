"use client"

import { useLocale, useTranslations } from "next-intl"
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { ChartTable, Swatch, TipBox } from "@/features/dashboard/components/charts"
import { isRtl } from "@/i18n/routing"
import { formatDate, formatNumber, intlLocale } from "@/lib/format"

export type DayPoint = { day: string; views: number; visitors: number }

/**
 * Visitors (bars) and pages seen (a line) per day, on one count axis, like
 * the dashboard's charts: the SVG laid out left to right, mirrored for
 * Persian; a tooltip per day and a screen-reader table.
 */
export function VisitsChart({ data }: { data: DayPoint[] }) {
  const t = useTranslations("analytics.chart")
  const locale = useLocale()
  const rtl = isRtl(locale)
  const config = {
    visitors: { label: t("visitors"), color: "var(--chart-1)" },
    views: { label: t("views"), color: "var(--chart-2)" },
  } satisfies ChartConfig
  const num = (v: number) => formatNumber(v, locale)
  const noon = (day: string) => `${day}T09:00:00Z`
  // Axis ticks: day and month only ("17 Eki", "۲۵ مهر"), in the language's calendar.
  const tick = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "Europe/Istanbul" })
  const rows = data.map((d) => ({
    ...d,
    label: tick.format(new Date(noon(d.day))),
    full: formatDate(noon(d.day), locale, "full"),
  }))

  return (
    <div className="space-y-4">
      <ul className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <li className="flex items-center gap-1.5">
          <Swatch color={config.visitors.color} />
          {config.visitors.label}
        </li>
        <li className="flex items-center gap-1.5">
          <Swatch color={config.views.color} shape="line" />
          {config.views.label}
        </li>
      </ul>
      <ChartContainer config={config} dir="ltr" className="aspect-auto h-64 w-full sm:h-72">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" reversed={rtl} tickLine={false} axisLine={false} tickMargin={10} minTickGap={16} />
          <YAxis
            orientation={rtl ? "right" : "left"}
            width={40}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickFormatter={(v: number) => num(v)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as (typeof rows)[number] | undefined
              if (!active || !row) return null
              return (
                <TipBox
                  title={row.full}
                  rows={[
                    { label: config.visitors.label, value: num(row.visitors), color: config.visitors.color },
                    { label: config.views.label, value: num(row.views), color: config.views.color },
                  ]}
                />
              )
            }}
          />
          <Bar dataKey="visitors" fill="var(--color-visitors)" radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={800} />
          <Line
            dataKey="views"
            type="monotone"
            stroke="var(--color-views)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 5, fill: "var(--color-views)", stroke: "var(--card)", strokeWidth: 2 }}
            animationDuration={1000}
          />
        </ComposedChart>
      </ChartContainer>
      <ChartTable
        caption={t("tableCaption")}
        head={[t("day"), config.visitors.label, config.views.label]}
        rows={rows.map((r) => [r.full, num(r.visitors), num(r.views)])}
      />
    </div>
  )
}
