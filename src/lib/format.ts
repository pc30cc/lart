/**
 * Locale-aware formatting for the whole app (server and client).
 * The business runs in Europe/Istanbul; Persian uses the Gregorian calendar
 * with Persian digits.
 */
import type { LocalizedText } from "@/db/schema"

export const TIME_ZONE = "Europe/Istanbul"

type DateInput = Date | string | number

/** The Intl locale for an app locale. */
export function intlLocale(locale: string): string {
  if (locale === "fa") return "fa-IR-u-ca-gregory"
  if (locale === "en") return "en-GB"
  return "tr-TR"
}

const cache = new Map<string, Intl.DateTimeFormat>()
function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options)
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(locale), { timeZone: TIME_ZONE, ...options })
    cache.set(key, f)
  }
  return f
}

const toDate = (v: DateInput) => (v instanceof Date ? v : new Date(v))

const dateStyles = {
  short: { day: "numeric", month: "numeric", year: "numeric" },
  medium: { day: "numeric", month: "short", year: "numeric" },
  long: { day: "numeric", month: "long", year: "numeric" },
  full: { weekday: "long", day: "numeric", month: "long", year: "numeric" },
} satisfies Record<string, Intl.DateTimeFormatOptions>

export type DateStyle = keyof typeof dateStyles

/** "14 Oct 2026" / "14 Eki 2026" / "۱۴ اکتبر ۲۰۲۶". `full` adds the weekday. */
export function formatDate(value: DateInput, locale: string, style: DateStyle = "medium"): string {
  return dtf(locale, dateStyles[style]).format(toDate(value))
}

/** 24-hour time, e.g. "18:30" / "۱۸:۳۰". */
export function formatTime(value: DateInput, locale: string): string {
  return dtf(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(toDate(value))
}

export function formatDateTime(value: DateInput, locale: string, style: DateStyle = "medium"): string {
  return dtf(locale, { ...dateStyles[style], hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    toDate(value),
  )
}

/** "Tuesday" / "Salı" / "سه‌شنبه". */
export function formatWeekday(value: DateInput, locale: string, style: "long" | "short" = "long"): string {
  return dtf(locale, { weekday: style }).format(toDate(value))
}

/** "18:00–20:30". */
export function formatTimeRange(start: DateInput, end: DateInput, locale: string): string {
  return `${formatTime(start, locale)}–${formatTime(end, locale)}`
}

export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value)
}

/** A fraction as a percentage: 0.335 → "33.5%". For basis points pass bp / 10000. */
export function formatPercent(fraction: number, locale: string, maxFractionDigits = 1): string {
  return formatNumber(fraction, locale, { style: "percent", maximumFractionDigits: maxFractionDigits })
}

/** Persian and Arabic digits (and separators) typed on a phone keyboard → ASCII. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٫/g, ",") // Arabic decimal separator
    .replace(/٬/g, ".") // Arabic thousands separator
}

// ─── Localized text ───────────────────────────────────────────────────────────

const fallbackOrder = ["tr", "en", "fa"] as const

/** The text in `locale`, falling back to Turkish, English, then Persian. */
export function localized(text: LocalizedText | null | undefined, locale: string): string {
  if (!text) return ""
  const own = text[locale as keyof LocalizedText]?.trim()
  if (own) return own
  for (const l of fallbackOrder) if (text[l]?.trim()) return text[l]!.trim()
  return ""
}

// ─── Slugs ────────────────────────────────────────────────────────────────────

/** URL slug from Latin text, Turkish-aware: "Mum Yapımı Atölyesi" → "mum-yapimi-atolyesi". */
export function slugify(input: string, maxLength = 80): string {
  return input
    .replace(/[İı]/g, "i")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/[øœ]/g, "o")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "")
}

// ─── Istanbul wall-clock time ↔ instants ──────────────────────────────────────

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

function wallClock(instant: number) {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(instant)).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second }
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Istanbul calendar date and time of an instant: { date: "2026-10-14", time: "18:30" }. */
export function zonedParts(value: DateInput): { date: string; time: string } {
  const w = wallClock(toDate(value).getTime())
  return { date: `${w.y}-${pad(w.m)}-${pad(w.d)}`, time: `${pad(w.h)}:${pad(w.min)}` }
}

/**
 * The instant (ISO string, UTC) of an Istanbul date ("YYYY-MM-DD") and time
 * ("HH:mm"), or null when either is missing or invalid.
 */
export function zonedToIso(date: string, time: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dm || !tm) return null
  const [y, m, d, h, min] = [+dm[1], +dm[2], +dm[3], +tm[1], +tm[2]]
  if (h > 23 || min > 59) return null
  const guess = Date.UTC(y, m - 1, d, h, min)
  const check = new Date(guess)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null
  const offset = (t: number) => {
    const w = wallClock(t)
    return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(t / 1000) * 1000
  }
  let instant = guess - offset(guess)
  const second = offset(instant)
  if (second !== offset(guess)) instant = guess - second
  return new Date(instant).toISOString()
}
