/**
 * Audit `data` for the activity log table (client-safe, no server code): a
 * one-line summary and a readable, size-limited JSON for the details popover.
 */

const SUMMARY_MAX = 140
const VALUE_MAX = 40
const DETAIL_STRING_MAX = 400
const DETAIL_MAX = 6_000

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)
const isChange = (v: unknown): v is { from: unknown; to: unknown } =>
  isRecord(v) && Object.keys(v).length === 2 && "from" in v && "to" in v

/** A short text for any JSON value. Localized texts show their first language. */
function short(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "string") return clip(value.replace(/\s+/g, " ").trim(), VALUE_MAX)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.length ? clip(value.slice(0, 3).map(short).join(", "), VALUE_MAX) : "—"
  if (isRecord(value)) {
    const text = ["fa", "tr", "en"].map((l) => value[l]).find((v) => typeof v === "string" && v.trim())
    return text ? short(text) : "{…}"
  }
  return "…"
}

/** "slug: candles → candle-making · sort: 1 → 2" */
export function auditSummary(data: unknown): string {
  if (data === null || data === undefined) return ""
  if (!isRecord(data)) return clip(short(data), SUMMARY_MAX)
  const parts = Object.entries(data).map(([key, value]) =>
    isChange(value) ? `${key}: ${short(value.from)} → ${short(value.to)}` : `${key}: ${short(value)}`,
  )
  return clip(parts.join(" · "), SUMMARY_MAX)
}

/** Pretty JSON with long strings (e.g. a whole template text) shortened. */
export function auditDetail(data: unknown): string {
  if (data === null || data === undefined) return ""
  const json = JSON.stringify(data, (_key, value: unknown) => (typeof value === "string" ? clip(value, DETAIL_STRING_MAX) : value), 2)
  return clip(json ?? "", DETAIL_MAX)
}
