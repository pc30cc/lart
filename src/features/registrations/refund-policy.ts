/**
 * Refund rule of the default registration terms (README §4):
 * 72 hours or more before the start: 100 %; between 72 and 24 hours: 50 %;
 * less than 24 hours, or not attending: 0 %. A workshop cancelled by the
 * business is always refunded in full (handled by the caller).
 */
const HOUR = 60 * 60_000

export type RefundPercent = 100 | 50 | 0

export function refundPercent(startsAt: Date, cancelledAt: Date): RefundPercent {
  const left = startsAt.getTime() - cancelledAt.getTime()
  if (left >= 72 * HOUR) return 100
  if (left >= 24 * HOUR) return 50
  return 0
}

/** Refund in kuruş for a paid amount, rounded down to a whole kuruş. */
export function refundAmount(paid: number, startsAt: Date, cancelledAt: Date): number {
  return Math.floor((paid * refundPercent(startsAt, cancelledAt)) / 100)
}
