/**
 * Locale-aware formatting for the whole app (server and client).
 * The business runs in Europe/Istanbul. Each language shows dates in its own
 * calendar: Persian in the Solar Hijri (Jalali) calendar with Persian digits
 * ("۱۶ مهر ۱۴۰۵"), Turkish and English in the Gregorian ("16 Ekim 2026",
 * "16 Oct 2026"). Stored dates, URLs and machine formats stay Gregorian ISO.
 */
import type { LocalizedText } from "@/db/schema"

export const TIME_ZONE = "Europe/Istanbul"

type DateInput = Date | string | number

/** The calendar a language shows dates in. */
export type CalendarSystem = "persian" | "gregory"
export const calendarOf = (locale: string): CalendarSystem => (locale === "fa" ? "persian" : "gregory")

/** The Intl locale for an app locale (its calendar and digits included). */
export function intlLocale(locale: string): string {
  if (locale === "fa") return "fa-IR-u-ca-persian-nu-arabext"
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

/** The parts of an instant in `locale`'s calendar, in Istanbul ("day", "month", "year", "weekday"…). */
function parts(value: DateInput, locale: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  return Object.fromEntries(dtf(locale, options).formatToParts(toDate(value)).map((p) => [p.type, p.value]))
}

/**
 * A Persian date in its natural order, put together from its parts: ICU's
 * patterns for the Persian calendar write the year first with a Latin comma
 * in places ("۱۴۰۵ مهر ۱۶, پنجشنبه"), and the parts are the same in every
 * ICU build (server and browser render the same text).
 */
function persianDate(value: DateInput, style: DateStyle): string {
  if (style === "short") {
    const p = parts(value, "fa", dateStyles.short)
    return `${p.year}/${p.month}/${p.day}`
  }
  const p = parts(value, "fa", style === "full" ? dateStyles.full : dateStyles.long)
  const date = `${p.day} ${p.month} ${p.year}`
  return style === "full" ? `${p.weekday} ${date}` : date
}

/**
 * "14 Oct 2026" / "14 Eki 2026" / "۲۲ مهر ۱۴۰۵". `full` adds the weekday.
 * The English `full` text differs between ICU builds ("Tuesday, 20 October
 * 2026" in Node, no comma in Chromium): a client component that renders it
 * during SSR must put `suppressHydrationWarning` on the element holding it.
 */
export function formatDate(value: DateInput, locale: string, style: DateStyle = "medium"): string {
  if (locale === "fa") return persianDate(value, style)
  return dtf(locale, dateStyles[style]).format(toDate(value))
}

/** 24-hour time, e.g. "18:30" / "۱۸:۳۰". */
export function formatTime(value: DateInput, locale: string): string {
  return dtf(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(toDate(value))
}

/** A date and its time: "14 Oct 2026, 18:30" / "۲۲ مهر ۱۴۰۵، ۱۸:۳۰" / "پنجشنبه ۲۲ مهر ۱۴۰۵ ساعت ۱۸:۳۰". */
export function formatDateTime(value: DateInput, locale: string, style: DateStyle = "medium"): string {
  if (locale === "fa") {
    const glue = style === "long" || style === "full" ? " ساعت " : "، "
    return `${persianDate(value, style)}${glue}${formatTime(value, locale)}`
  }
  return dtf(locale, { ...dateStyles[style], hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    toDate(value),
  )
}

/** The name of the month of `locale`'s calendar: "Oct" / "October", "Eki" / "Ekim", "مهر" (Persian months have no short names). */
export function formatMonth(value: DateInput, locale: string, width: "short" | "long" = "long"): string {
  return dtf(locale, { month: locale === "fa" ? "long" : width }).format(toDate(value))
}

/** A month of `locale`'s calendar: "October 2026" / "Ekim 2026" / "مهر ۱۴۰۵". */
export function formatMonthYear(value: DateInput, locale: string): string {
  if (locale === "fa") {
    const p = parts(value, "fa", { month: "long", year: "numeric" })
    return `${p.month} ${p.year}`
  }
  return dtf(locale, { month: "long", year: "numeric" }).format(toDate(value))
}

/** The year of `locale`'s calendar: "2026" / "۱۴۰۵" (Persian: the year part alone, never with an era). */
export function formatYear(value: DateInput, locale: string): string {
  if (locale === "fa") return parts(value, "fa", { year: "numeric" }).year
  return dtf(locale, { year: "numeric" }).format(toDate(value))
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

/**
 * Keeps a value (an amount, a name) in one piece inside right-to-left text
 * (U+2068 … U+2069): "Ayşe K." inside a Persian sentence keeps its period on
 * the right side.
 */
export const isolate = (text: string) => `\u2068${text}\u2069`

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
