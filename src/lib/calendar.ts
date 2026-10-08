/**
 * Periods (a month, a quarter, a year) in the calendar of a language
 * (lib/format `calendarOf`): Persian counts Solar Hijri months, seasons and
 * years (Mehr 1405 = 23 Sep – 22 Oct 2026), Turkish and English Gregorian ones.
 * Days are Gregorian ISO dates ("2026-10-08", Istanbul's calendar days), as
 * stored and queried; only where a period starts and ends follows the
 * calendar. Pure: the same on the server and in the browser.
 */
import {
  addMonths,
  addQuarters,
  addYears,
  getMonth,
  getQuarter,
  getYear,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
} from "date-fns"
import {
  addMonths as jalaliAddMonths,
  addQuarters as jalaliAddQuarters,
  addYears as jalaliAddYears,
  getMonth as jalaliGetMonth,
  getQuarter as jalaliGetQuarter,
  getYear as jalaliGetYear,
  startOfMonth as jalaliStartOfMonth,
  startOfQuarter as jalaliStartOfQuarter,
  startOfYear as jalaliStartOfYear,
} from "date-fns-jalali"

import type { CalendarSystem } from "./format"

export type PeriodUnit = "month" | "quarter" | "year"

// Named imports only: this runs in the browser too (the money range filter), and keeps the bundle to these.
const libs = {
  gregory: { addMonths, addQuarters, addYears, getMonth, getQuarter, getYear, startOfMonth, startOfQuarter, startOfYear },
  persian: {
    addMonths: jalaliAddMonths,
    addQuarters: jalaliAddQuarters,
    addYears: jalaliAddYears,
    getMonth: jalaliGetMonth,
    getQuarter: jalaliGetQuarter,
    getYear: jalaliGetYear,
    startOfMonth: jalaliStartOfMonth,
    startOfQuarter: jalaliStartOfQuarter,
    startOfYear: jalaliStartOfYear,
  },
} as const

const pad = (n: number) => String(n).padStart(2, "0")

/** An ISO day as a local Date at noon: no time zone can move it to another day. */
function toLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d, 12)
}

const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The first day of the period that holds `iso`. */
export function periodStart(iso: string, unit: PeriodUnit, calendar: CalendarSystem): string {
  const lib = libs[calendar]
  const day = toLocal(iso)
  return toIso(unit === "month" ? lib.startOfMonth(day) : unit === "quarter" ? lib.startOfQuarter(day) : lib.startOfYear(day))
}

/** `iso` moved by `count` periods (a month from 31 Jan is 28 or 29 Feb; from 31 Shahrivar, 30 Mehr). */
export function addPeriods(iso: string, count: number, unit: PeriodUnit, calendar: CalendarSystem): string {
  const lib = libs[calendar]
  const day = toLocal(iso)
  return toIso(unit === "month" ? lib.addMonths(day, count) : unit === "quarter" ? lib.addQuarters(day, count) : lib.addYears(day, count))
}

/** The day before `iso`. */
export function dayBefore(iso: string): string {
  return toIso(subDays(toLocal(iso), 1))
}

/** The last day of the period that holds `iso`. */
export function periodEnd(iso: string, unit: PeriodUnit, calendar: CalendarSystem): string {
  return dayBefore(addPeriods(periodStart(iso, unit, calendar), 1, unit, calendar))
}

/** The first days of every period from the one holding `from` to the one holding `to`. */
export function periodStarts(from: string, to: string, unit: PeriodUnit, calendar: CalendarSystem): string[] {
  const out: string[] = []
  for (let start = periodStart(from, unit, calendar); start <= to && out.length < 1200; start = addPeriods(start, 1, unit, calendar)) {
    out.push(start)
  }
  return out
}

/** The calendar's own year, month (1–12) and quarter (1–4) of `iso`: 2026-10-08 is 1405, 7, 3 in Persian. */
export function calendarFields(iso: string, calendar: CalendarSystem): { year: number; month: number; quarter: number } {
  const lib = libs[calendar]
  const day = toLocal(iso)
  return { year: lib.getYear(day), month: lib.getMonth(day) + 1, quarter: lib.getQuarter(day) }
}
