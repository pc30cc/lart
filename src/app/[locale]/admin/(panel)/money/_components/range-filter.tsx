"use client"

import { CalendarRangeIcon, XIcon } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { addPeriods, periodEnd, periodStart, type PeriodUnit } from "@/lib/calendar"
import { calendarOf, formatDate, zonedParts, type CalendarSystem } from "@/lib/format"
import { cn } from "@/lib/utils"

const pad = (n: number) => String(n).padStart(2, "0")
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const local = (s: string) => new Date(`${s}T12:00:00`)

/** Ready-made ranges, from today's date in Istanbul, in the language's calendar (Persian: Jalali months, seasons, years). */
function presets(calendar: CalendarSystem) {
  const today = zonedParts(new Date()).date
  const whole = (start: string, unit: PeriodUnit) => ({ from: start, to: periodEnd(start, unit, calendar) })
  const month = periodStart(today, "month", calendar)
  const year = periodStart(today, "year", calendar)
  return {
    thisMonth: whole(month, "month"),
    lastMonth: whole(addPeriods(month, -1, "month", calendar), "month"),
    thisQuarter: whole(periodStart(today, "quarter", calendar), "quarter"),
    thisYear: whole(year, "year"),
    lastYear: whole(addPeriods(year, -1, "year", calendar), "year"),
  }
}

/**
 * A date range kept in the URL (?from=&to=), with quick choices (this month,
 * this year, ...) and a two-month calendar. `clearable`: "all dates" is allowed.
 */
export function RangeFilter({ from, to, clearable = false }: { from?: string; to?: string; clearable?: boolean }) {
  const t = useTranslations("money.range")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()

  function apply(range: { from: string; to: string } | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (range) {
      next.set("from", range.from)
      next.set("to", range.to)
    } else {
      next.delete("from")
      next.delete("to")
    }
    next.delete("page")
    setOpen(false)
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }

  const label =
    from && to
      ? `${formatDate(`${from}T09:00:00Z`, locale, "medium")} – ${formatDate(`${to}T09:00:00Z`, locale, "medium")}`
      : t("allDates")
  const choices = presets(calendarOf(locale))

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setDraft(from && to ? { from: local(from), to: local(to) } : undefined)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("bg-card h-9 justify-start gap-2 px-3 font-normal", pending && "opacity-70")}
            aria-label={t("label")}
          >
            <CalendarRangeIcon className="text-muted-foreground" />
            <span className="truncate tabular-nums">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <div className="flex flex-col sm:flex-row">
            <ul className="flex flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-e sm:border-b-0">
              {(Object.keys(choices) as (keyof typeof choices)[]).map((key) => (
                <li key={key}>
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => apply(choices[key])}>
                    {t(key)}
                  </Button>
                </li>
              ))}
            </ul>
            <Calendar
              mode="range"
              selected={draft}
              defaultMonth={draft?.from}
              numberOfMonths={2}
              onSelect={(range) => {
                setDraft(range)
                if (range?.from && range.to && range.from.getTime() !== range.to.getTime()) {
                  apply({ from: iso(range.from), to: iso(range.to) })
                }
              }}
            />
          </div>
        </PopoverContent>
      </Popover>
      {clearable && from && to && (
        <Button variant="ghost" size="icon-sm" aria-label={t("clear")} onClick={() => apply(null)}>
          <XIcon />
        </Button>
      )}
    </div>
  )
}
