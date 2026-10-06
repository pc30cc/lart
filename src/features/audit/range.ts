/**
 * The activity log's date range in the URL: ?from=YYYY-MM-DD&to=YYYY-MM-DD,
 * whole days in Istanbul time, both ends included. Client-safe.
 */
import type { SearchParams } from "@/components/admin/data-table/params"

export type DateRange = { from?: string; to?: string }

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date "YYYY-MM-DD", or undefined. */
export function validDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const m = DATE.exec(value)
  if (!m) return undefined
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2000
    ? value
    : undefined
}

/** The range from the URL; reversed ends are swapped. */
export function parseDateRange(searchParams: SearchParams): DateRange {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  let from = validDate(first(searchParams.from))
  let to = validDate(first(searchParams.to))
  if (from && to && from > to) [from, to] = [to, from]
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) }
}

/** The calendar day `days` after (or before) `date`, both "YYYY-MM-DD". */
export function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export const nextDay = (date: string) => shiftDay(date, 1)
