"use client"

import { CalendarRangeIcon, XIcon } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import type { DateRange } from "react-day-picker"
import { enGB, faIR, tr } from "react-day-picker/locale"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { formatDate, zonedParts } from "@/lib/format"
import { cn } from "@/lib/utils"

const dayPickerLocales = { fa: faIR, tr, en: enGB }
const pad = (n: number) => String(n).padStart(2, "0")
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const local = (s: string) => new Date(`${s}T12:00:00`)
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate() // m: 0-based

/** Ready-made ranges, from today's date in Istanbul. */
function presets() {
  const [y, m] = zonedParts(new Date()).date.split("-").map(Number)
  const month = (yy: number, mm: number) => ({ from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${pad(lastDay(yy, mm - 1))}` })
  const q = Math.floor((m - 1) / 3) * 3 + 1
  return {
    thisMonth: month(y, m),
    lastMonth: m === 1 ? month(y - 1, 12) : month(y, m - 1),
    thisQuarter: { from: `${y}-${pad(q)}-01`, to: `${y}-${pad(q + 2)}-${pad(lastDay(y, q + 1))}` },
    thisYear: { from: `${y}-01-01`, to: `${y}-12-31` },
    lastYear: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
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
  const choices = presets()

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
              locale={dayPickerLocales[locale as keyof typeof dayPickerLocales] ?? tr}
              numerals={locale === "fa" ? "arabext" : undefined}
              dir={locale === "fa" ? "rtl" : "ltr"}
              weekStartsOn={1}
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
