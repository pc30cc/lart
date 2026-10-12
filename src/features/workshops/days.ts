import { formatDate, formatTimeRange, zonedParts, zonedToIso } from "@/lib/format"

/**
 * Workshops on several days (`courses.days`): each day at the same hours as
 * the first. `starts_at` is the first day's start and `ends_at` the last
 * day's end, so "has it started / ended" reads the same as for one day.
 * Client-safe.
 */

export type StoredDays = { startsAt: string; endsAt: string }[] | null | undefined
export type WorkshopDay = { startsAt: Date; endsAt: Date }
type WithDays = { startsAt: Date; endsAt: Date; days?: StoredDays }

/** Every day of the workshop (one for a one-day workshop). */
export function workshopDays(c: WithDays): WorkshopDay[] {
  if (c.days && c.days.length > 1) return c.days.map((d) => ({ startsAt: new Date(d.startsAt), endsAt: new Date(d.endsAt) }))
  return [{ startsAt: c.startsAt, endsAt: c.endsAt }]
}

/** "Saturday 17 October, Tuesday 20 October": every day, in the language's calendar. */
export function formatWorkshopDates(c: WithDays, locale: string, style: "full" | "long" | "medium" = "full"): string {
  return workshopDays(c)
    .map((d) => formatDate(d.startsAt, locale, style))
    .join(locale === "fa" ? "، " : locale === "tr" ? ", " : " · ")
}

/** The daily hours ("12:00–15:00"): the first day's (every day has the same). */
export function workshopHours(c: WithDays, locale: string): string {
  const [first] = workshopDays(c)
  return formatTimeRange(first.startsAt, first.endsAt, locale)
}

/** The other days' dates ("YYYY-MM-DD", Istanbul) of a workshop, for its edit form. */
export function extraDatesOf(c: WithDays): string[] {
  return workshopDays(c)
    .slice(1)
    .map((d) => zonedParts(d.startsAt).date)
}

/**
 * The stored days and the workshop's end from the first day and the other
 * days' dates (each at the first day's hours, Istanbul time). One day: null.
 */
export function buildDays(startsAt: Date, endsAt: Date, extraDates: string[]): { days: { startsAt: string; endsAt: string }[] | null; endsAt: Date } {
  if (extraDates.length === 0) return { days: null, endsAt }
  const from = zonedParts(startsAt).time
  const to = zonedParts(endsAt).time
  const later = [...new Set(extraDates)].sort().map((date) => ({ startsAt: zonedToIso(date, from)!, endsAt: zonedToIso(date, to)! }))
  const days = [{ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }, ...later]
  return { days, endsAt: new Date(days[days.length - 1].endsAt) }
}
