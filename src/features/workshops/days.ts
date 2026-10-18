import { formatDate, formatNumber, formatTimeRange, zonedParts, zonedToIso } from "@/lib/format"

/**
 * Workshops on several days (`courses.days`): every day with its own hours
 * and, if it differs from the workshop's, its own number of participants
 * (for the contract). `starts_at` is the first day's start and `ends_at` the
 * last day's end, so "has it started / ended" reads the same as for one day;
 * the first day's participants are the workshop's own (`min_capacity`,
 * `max_capacity`, which also limit the registrations). Client-safe.
 */

export type StoredDay = { startsAt: string; endsAt: string; minCapacity?: number; maxCapacity?: number }
export type StoredDays = StoredDay[] | null | undefined
export type WorkshopDay = { startsAt: Date; endsAt: Date; minCapacity?: number; maxCapacity?: number }
type WithDays = { startsAt: Date; endsAt: Date; days?: StoredDays; minCapacity?: number; maxCapacity?: number }

/** One of the other days in the workshop form: an Istanbul date, its hours ("HH:mm") and participants. */
export type ExtraDay = { date: string; start: string; end: string; minCapacity: number; maxCapacity: number }

/** Every day of the workshop (one for a one-day workshop), with its participants when known. */
export function workshopDays(c: WithDays): WorkshopDay[] {
  const own = { minCapacity: c.minCapacity, maxCapacity: c.maxCapacity }
  if (c.days && c.days.length > 1) {
    return c.days.map((d, i) => ({
      startsAt: new Date(d.startsAt),
      endsAt: new Date(d.endsAt),
      minCapacity: i === 0 ? own.minCapacity : (d.minCapacity ?? own.minCapacity),
      maxCapacity: i === 0 ? own.maxCapacity : (d.maxCapacity ?? own.maxCapacity),
    }))
  }
  return [{ startsAt: c.startsAt, endsAt: c.endsAt, ...own }]
}

const separator = (locale: string) => (locale === "fa" ? "، " : locale === "tr" ? ", " : " · ")

const hoursOf = (d: WorkshopDay, locale: string) => formatTimeRange(d.startsAt, d.endsAt, locale)

/** Whether every day is held at the same hours. */
export function sameHours(c: WithDays): boolean {
  const days = workshopDays(c)
  const key = (d: WorkshopDay) => `${zonedParts(d.startsAt).time}-${zonedParts(d.endsAt).time}`
  return days.every((d) => key(d) === key(days[0]))
}

/**
 * "Saturday 17 October, Tuesday 20 October": every day, in the language's
 * calendar; two sessions on the same day name it once.
 */
export function formatWorkshopDates(c: WithDays, locale: string, style: "full" | "long" | "medium" = "full"): string {
  return [...new Set(workshopDays(c).map((d) => formatDate(d.startsAt, locale, style)))].join(separator(locale))
}

/**
 * The hours ("12:00–15:00"). When the days have different hours, each day's,
 * in the order of `formatWorkshopDates` ("12:00–15:00, 10:00–13:00").
 */
export function workshopHours(c: WithDays, locale: string): string {
  const days = workshopDays(c)
  if (sameHours(c)) return hoursOf(days[0], locale)
  return days.map((d) => hoursOf(d, locale)).join(separator(locale))
}

/** Each day on its own line: "Saturday 17 October · 12:00–15:00". */
export function workshopSchedule(c: WithDays, locale: string, style: "full" | "long" | "medium" = "full"): { date: string; hours: string; minCapacity?: number; maxCapacity?: number }[] {
  return workshopDays(c).map((d) => ({
    date: formatDate(d.startsAt, locale, style),
    hours: hoursOf(d, locale),
    minCapacity: d.minCapacity,
    maxCapacity: d.maxCapacity,
  }))
}

/** "4–10" participants of a day, in the language's digits. */
export function formatDayCapacity(d: { minCapacity?: number; maxCapacity?: number }, locale: string): string {
  if (d.minCapacity === undefined || d.maxCapacity === undefined) return ""
  return `${formatNumber(d.minCapacity, locale)}–${formatNumber(d.maxCapacity, locale)}`
}

/** The other days of a workshop, for its edit form. */
export function extraDaysOf(c: WithDays & { minCapacity: number; maxCapacity: number }): ExtraDay[] {
  return workshopDays(c)
    .slice(1)
    .map((d) => ({
      date: zonedParts(d.startsAt).date,
      start: zonedParts(d.startsAt).time,
      end: zonedParts(d.endsAt).time,
      minCapacity: d.minCapacity ?? c.minCapacity,
      maxCapacity: d.maxCapacity ?? c.maxCapacity,
    }))
}

/**
 * The stored days and the workshop's end from the first day and the other
 * days (Istanbul time, sorted by date). One day: null.
 */
export function buildDays(startsAt: Date, endsAt: Date, extraDays: ExtraDay[]): { days: StoredDay[] | null; endsAt: Date } {
  if (extraDays.length === 0) return { days: null, endsAt }
  const later = [...extraDays]
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .map((d) => ({
      startsAt: zonedToIso(d.date, d.start)!,
      endsAt: zonedToIso(d.date, d.end)!,
      minCapacity: d.minCapacity,
      maxCapacity: d.maxCapacity,
    }))
  const days = [{ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }, ...later]
  return { days, endsAt: new Date(days[days.length - 1].endsAt) }
}

/**
 * A day's date for lists ("26 Mehr 1405"), with its hours too when another
 * day of the workshop falls on the same date (two sessions on one day):
 * "2 Aban 1405 · 16:00–19:00". `day` is the index (null: the first).
 */
export function dayDateLabel(c: WithDays, day: number | null | undefined, locale: string, style: "full" | "long" | "medium" = "medium"): string {
  const days = workshopDays(c)
  const d = days[day ?? 0] ?? days[0]
  const date = zonedParts(d.startsAt).date
  const shared = days.filter((o) => zonedParts(o.startsAt).date === date).length > 1
  const label = formatDate(d.startsAt, locale, style)
  // The hours isolated (U+2068…U+2069, like a <bdi>): in Persian text the range keeps its order.
  return shared ? `${label} · \u2068${hoursOf(d, locale)}\u2069` : label
}

/**
 * The day a registration is for (`registrations.day`: its index, null for
 * the first), or the first day when that index is gone.
 */
export function registrationDay(c: WithDays, day: number | null | undefined): WorkshopDay {
  const days = workshopDays(c)
  return days[day ?? 0] ?? days[0]
}

/** The workshop as seen by one registration: only its day (for dates, hours, refunds and reminders). */
export function forDay<T extends WithDays>(c: T, day: number | null | undefined): T {
  const d = registrationDay(c, day)
  return { ...c, startsAt: d.startsAt, endsAt: d.endsAt, days: null }
}
