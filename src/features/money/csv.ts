/**
 * CSV for spreadsheets (RFC 4180, comma separated, CRLF, UTF-8 with a BOM so
 * Excel reads Persian and Turkish letters). Safe against CSV / formula
 * injection: a text cell starting with = + - @ (or a tab / carriage return) gets
 * a leading apostrophe, so a spreadsheet shows it as text instead of running it.
 * Numbers are written as numbers (a negative amount stays a number).
 */
export type Cell = string | number | null | undefined

const FORMULA_START = /^[=+\-@\t\r]/

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
