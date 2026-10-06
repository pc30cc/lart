/**
 * Pure helpers of the dashboard (no database, safe on the client): month
 * windows, changes between periods and the warnings shown on a workshop.
 */

/** How many months the charts and the "last 12 months" figures cover (this month included). */
export const MONTHS = 12
/** A go / no-go decision closer than this is flagged on the upcoming list. */
export const DECISION_SOON_MS = 3 * 24 * 3_600_000

const pad = (n: number) => String(n).padStart(2, "0")

/** The first day of the month `n` months after (or before, n < 0) the month of `date` ("YYYY-MM-DD"). */
export function addMonths(date: string, n: number): string {
  const total = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + n
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`
}

/** The first day of each of the last `count` months up to the month of `today`, oldest first. */
export function lastMonths(today: string, count = MONTHS): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(today, i - count + 1))
}

export type MonthFigures = { month: string; revenue: number; expenses: number; net: number }

/** One entry per month (missing months are zero), with net = revenue − expenses. */
export function fillMonths(
  months: string[],
  rows: { month: string; revenue: number; expenses: number }[],
): MonthFigures[] {
  const byMonth = new Map(rows.map((r) => [r.month, r]))
  return months.map((month) => {
    const revenue = byMonth.get(month)?.revenue ?? 0
    const expenses = byMonth.get(month)?.expenses ?? 0
    return { month, revenue, expenses, net: revenue - expenses }
  })
}

/** Relative change from `previous` to `current` (0.25 = +25 %), or null when there is nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return (current - previous) / previous
}

/** Share of seats taken (0..1+), or null when there are no seats. */
export function fillRate(taken: number, seats: number): number | null {
  return seats > 0 ? taken / seats : null
}

export type WorkshopAlert =
  | { kind: "awaitingSignature" }
  /** The decision time has passed: confirm or cancel. `missing`: registrations still short of the minimum. */
  | { kind: "decisionDue"; missing: number }
  | { kind: "decisionSoon"; at: Date; missing: number }
  | null

/** What needs attention on an upcoming workshop, if anything. */
export function workshopAlert(
  w: { status: string; decisionAt: Date; registered: number; minCapacity: number },
  now: Date,
): WorkshopAlert {
  if (w.status === "awaiting_signature") return { kind: "awaitingSignature" }
  if (w.status !== "published") return null
  const missing = Math.max(0, w.minCapacity - w.registered)
  if (w.decisionAt <= now) return { kind: "decisionDue", missing }
  if (w.decisionAt.getTime() - now.getTime() <= DECISION_SOON_MS) return { kind: "decisionSoon", at: w.decisionAt, missing }
  return null
}

/** Part of the day for the greeting, from an Istanbul "HH:mm" time. */
export function partOfDay(time: string): "morning" | "afternoon" | "evening" {
  const hour = Number(time.slice(0, 2))
  if (hour >= 5 && hour < 12) return "morning"
  if (hour >= 12 && hour < 18) return "afternoon"
  return "evening"
}
