/**
 * Refund rule of the registration terms (README §4): cancelled 72 hours or
 * more before the start: 100 %; less than 72 hours before it: 50 %; once it
 * has started, or not attending: 0 %. A workshop cancelled by the business is
 * always refunded in full (handled by the caller).
 */
const HOUR = 60 * 60_000

export type RefundPercent = 100 | 50 | 0

export function refundPercent(startsAt: Date, cancelledAt: Date): RefundPercent {
  const left = startsAt.getTime() - cancelledAt.getTime()
  if (left >= 72 * HOUR) return 100
  if (left > 0) return 50
  return 0
}

/** Refund in kuruş for a paid amount, rounded down to a whole kuruş. */
export function refundAmount(paid: number, startsAt: Date, cancelledAt: Date): number {
  return Math.floor((paid * refundPercent(startsAt, cancelledAt)) / 100)
}
