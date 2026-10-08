/**
 * Audit `data` for the activity log table (client-safe, no server code): a
 * one-line summary and a readable, size-limited JSON for the details popover.
 */

import { formatDate, formatDateTime, isolate } from "@/lib/format"
import { formatLira } from "@/lib/money"

const SUMMARY_MAX = 140
const VALUE_MAX = 40
const DETAIL_STRING_MAX = 400
const DETAIL_MAX = 6_000

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)
const isChange = (v: unknown): v is { from: unknown; to: unknown } =>
  isRecord(v) && Object.keys(v).length === 2 && "from" in v && "to" in v

/** Keys whose numbers are kuruş (lib/money): the summary shows lira, so ₺200 never reads as "20000". */
const MONEY_KEYS = new Set([
  "amount",
  "price",
  "revenue",
  "expenses",
  "instructorFee",
  "netProfit",
  "feeAmount",
  "advanceAmount",
  "refundAmount",
  "refundTotal",
])

const LOCALES = ["fa", "tr", "en"] as const
type Locale = (typeof LOCALES)[number]
const isLocale = (l: string): l is Locale => (LOCALES as readonly string[]).includes(l)
/** A `LocalizedText` ({ fa?, tr?, en? }), or null / undefined for "none" (an optional text). */
const isLocalizedOrNone = (v: unknown): v is Partial<Record<Locale, unknown>> | null | undefined =>
  v === null || v === undefined || (isRecord(v) && Object.keys(v).every(isLocale))
const textOf = (v: unknown) => (typeof v === "string" ? v.trim() : "")

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
/** A real calendar day: "2026-02-30" is not one (Date.parse would roll it over to 2 March). */
function isDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`)
  return ISO_DAY.test(day) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day
}

/**
 * A stored date as the page's language writes it, in its calendar and in
 * Istanbul time: "2026-10-08" → "۱۶ مهر ۱۴۰۵", "2026-10-14T15:00:00.000Z" →
 * "14 Oct 2026, 18:00". Null when `value` is not an ISO day or instant.
 */
function asDate(value: string, locale: string): string | null {
  // A day is shown from its noon in Istanbul, so no time zone moves it.
  if (isDay(value)) return formatDate(`${value}T09:00:00Z`, locale, "medium")
  const instant = ISO_INSTANT.exec(value)
  return instant && isDay(instant[1]) ? formatDateTime(value, locale, "medium") : null
}

/** A short text for any JSON value. Localized texts show the page's language, else the first one filled in; dates its calendar. */
function short(value: unknown, locale?: string): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "string") return clip((locale && asDate(value, locale)) || value.replace(/\s+/g, " ").trim(), VALUE_MAX)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.length ? clip(value.slice(0, 3).map((v) => short(v, locale)).join(", "), VALUE_MAX) : "—"
  if (isRecord(value)) {
    const text = [locale, ...LOCALES].map((l) => (l ? value[l] : undefined)).find((v) => typeof v === "string" && v.trim())
    return text ? short(text) : "{…}"
  }
  return "…"
}

/**
 * The value of `key` in the summary: amounts in kuruş as lira, anything else
 * as `short`. Isolated (lib/format `isolate`): in a line that starts with a
 * Latin key, a Persian date or text keeps its own order ("۲۲ مهر ۱۴۰۵ → ۲۹ مهر ۱۴۰۵",
 * not its day pulled to the key and the arrow's sides swapped).
 */
const shown = (key: string, value: unknown, locale: string) =>
  isolate(MONEY_KEYS.has(key) && typeof value === "number" && Number.isSafeInteger(value) ? formatLira(value, locale) : short(value, locale))

/**
 * A change of a localized text, in the language that changed: the page's
 * language when it is one of them, otherwise the first that changed
 * ("venue (tr): Moda → Kadıköy"). Null when it is not a localized text.
 */
function localizedChange(key: string, from: unknown, to: unknown, locale: string): string | null {
  if (!isLocalizedOrNone(from) || !isLocalizedOrNone(to) || (!isRecord(from) && !isRecord(to))) return null
  const changed = LOCALES.filter((l) => textOf(from?.[l]) !== textOf(to?.[l]))
  if (!changed.length) return null
  const lang = changed.find((l) => l === locale) ?? changed[0]
  return `${key} (${lang}): ${isolate(short(from?.[lang]))} → ${isolate(short(to?.[lang]))}`
}

/** "slug: candles → candle-making · venue (tr): Moda → Kadıköy · price: ₺1,500 → ₺1,800" */
export function auditSummary(data: unknown, locale: string): string {
  if (data === null || data === undefined) return ""
  if (!isRecord(data)) return clip(short(data, locale), SUMMARY_MAX)
  const parts = Object.entries(data).map(([key, value]) =>
    isChange(value)
      ? (localizedChange(key, value.from, value.to, locale) ??
        `${key}: ${shown(key, value.from, locale)} → ${shown(key, value.to, locale)}`)
      : `${key}: ${shown(key, value, locale)}`,
  )
  return clip(parts.join(" · "), SUMMARY_MAX)
}

/** Pretty JSON with long strings (e.g. a whole template text) shortened. */
export function auditDetail(data: unknown): string {
  if (data === null || data === undefined) return ""
  const json = JSON.stringify(data, (_key, value: unknown) => (typeof value === "string" ? clip(value, DETAIL_STRING_MAX) : value), 2)
  return clip(json ?? "", DETAIL_MAX)
}
