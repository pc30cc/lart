import { calendarFields, type PeriodUnit } from "@/lib/calendar"
import { calendarOf, formatMonthYear, formatNumber, formatYear } from "@/lib/format"

const seasons = ["spring", "summer", "autumn", "winter"] as const

/**
 * A report period named by its first day ("2026-09-23"), in the viewer's
 * calendar: "مهر ۱۴۰۵", "پاییز ۱۴۰۵", "۱۴۰۵" (a Solar Hijri season is a
 * quarter: Farvardin–Khordad is spring); "October 2026", "Q4 2026", "2026".
 * `quarter` formats the message money.reports.quarter.
 */
export function periodLabel(
  start: string,
  unit: PeriodUnit,
  locale: string,
  quarter: (values: { quarter: string; season: (typeof seasons)[number]; year: string }) => string,
): string {
  const day = `${start}T09:00:00Z` // noon in Istanbul, on that day
  if (unit === "month") return formatMonthYear(day, locale)
  if (unit === "year") return formatYear(day, locale)
  const fields = calendarFields(start, calendarOf(locale))
  return quarter({
    quarter: formatNumber(fields.quarter, locale),
    season: seasons[fields.quarter - 1],
    year: formatNumber(fields.year, locale, { useGrouping: false }),
  })
}
