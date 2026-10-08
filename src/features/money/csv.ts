import { calendarOf } from "@/lib/format"

/**
 * CSV for spreadsheets (RFC 4180, comma separated, CRLF, UTF-8 with a BOM so
 * Excel reads Persian and Turkish letters). Safe against CSV / formula
 * injection: a text cell starting with = + - @ (or a tab / carriage return),
 * also after leading spaces or line breaks, or with the full-width ＝ ＋ － ＠, gets
 * a leading apostrophe, so a spreadsheet shows it as text instead of running it.
 * Numbers are written as numbers (a negative amount stays a number).
 */
export type Cell = string | number | null | undefined

const FORMULA_START = /^\s*[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : ""
  const text = FORMULA_START.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Cell[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
}

/** Kuruş as a lira number for a spreadsheet: 125050 → 1250.5. */
export const lira = (kurus: number) => kurus / 100

const persianDay = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })

/**
 * A day ("YYYY-MM-DD") in the export's language's calendar: Turkish and
 * English keep the ISO date; Persian writes the Solar Hijri date, year first
 * with Latin digits ("1405/07/16"), as Iranian spreadsheets do, so the column
 * still sorts.
 */
export function csvDate(day: string, locale: string): string {
  if (calendarOf(locale) !== "persian") return day
  const p = Object.fromEntries(persianDay.formatToParts(new Date(`${day}T12:00:00Z`)).map((x) => [x.type, x.value]))
  return `${p.year}/${p.month}/${p.day}`
}
