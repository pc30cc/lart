"use client"

import { CalendarRangeIcon, XIcon } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import type { DateRange as DayRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { shiftDay, type DateRange } from "@/features/audit/range"
import { periodStart } from "@/lib/calendar"
import { calendarOf, formatDate, zonedParts } from "@/lib/format"
import { cn } from "@/lib/utils"


/** "YYYY-MM-DD" ⇄ a local Date at noon (what the calendar works with). */
const toDay = (date?: string) => {
  if (!date) return undefined
  const [y, m, d] = date.split("-").map(Number)
  return new Date(y, m - 1, d, 12)
}
const fromDay = (day?: Date) =>
  day
    ? `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
    : undefined

/** Date range of the activity log, kept in the URL (?from=&to=, Istanbul days). */
export function DateRangeFilter({ from, to }: DateRange) {
  const t = useTranslations("settings.audit.range")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DayRange | undefined>(from || to ? { from: toDay(from), to: toDay(to) } : undefined)

  const today = zonedParts(new Date()).date
  const presets: { label: string; range: DateRange }[] = [
    { label: t("today"), range: { from: today, to: today } },
    { label: t("last7"), range: { from: shiftDay(today, -6), to: today } },
    { label: t("last30"), range: { from: shiftDay(today, -29), to: today } },
    // From the 1st of the month in the language's calendar (Persian: 1 Mehr, not 1 October).
    { label: t("thisMonth"), range: { from: periodStart(today, "month", calendarOf(locale)), to: today } },
  ]

  function apply(next: DateRange) {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of ["from", "to"] as const) {
      const value = next[key]
      if (value) params.set(key, value)
      else params.delete(key)
    }
    params.delete("page")
    const query = params.toString()
    setOpen(false)
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }

  const day = (date: string) => formatDate(`${date}T09:00:00Z`, locale, "medium")
  const label =
    from && to
      ? from === to
        ? day(from)
        : t("between", { from: day(from), to: day(to) })
      : from
        ? t("since", { date: day(from) })
        : to
          ? t("until", { date: day(to) })
          : t("all")
  const active = Boolean(from || to)

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setDraft(active ? { from: toDay(from), to: toDay(to) } : undefined)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="lg"
            aria-busy={pending}
            className={cn("bg-card px-3 font-normal", active && "border-primary/40 text-foreground")}
          >
            <CalendarRangeIcon className="text-muted-foreground" />
            <span className="max-w-64 truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <div className="flex flex-col sm:flex-row">
            <ul className="flex flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:border-e sm:border-b-0">
              {presets.map((preset) => (
                <li key={preset.label}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => apply(preset.range)}
                  >
                    {preset.label}
                  </Button>
                </li>
              ))}
            </ul>
            <Calendar
              mode="range"
              selected={draft}
              onSelect={setDraft}
              defaultMonth={draft?.from}
              disabled={{ after: new Date() }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <p className="text-muted-foreground px-1 text-xs">{t("timezone")}</p>
            <Button
              size="sm"
              disabled={!draft?.from}
              onClick={() => apply({ from: fromDay(draft?.from), to: fromDay(draft?.to ?? draft?.from) })}
            >
              {t("apply")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {active && (
        <Button variant="ghost" size="icon-lg" aria-label={t("clear")} title={t("clear")} onClick={() => apply({})}>
          <XIcon />
        </Button>
      )}
    </div>
  )
}
