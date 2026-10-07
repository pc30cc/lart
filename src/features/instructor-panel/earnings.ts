import { instructorFee } from "@/features/money/closing"

/**
 * An instructor's earnings for one workshop (amounts in kuruş). Pure: the
 * figures come from the contract, the workshop and the ledger (queries.ts).
 *
 * - `fee`: the agreed fee. Once the workshop's books are closed, the fee booked
 *   then; before, as the closing will count it (`instructorFee`): fixed, or per
 *   participant times the final number (or, before the go decision, everyone
 *   registered so far, paid or not yet: an estimate). A cancelled workshop pays no fee (6.2).
 * - `received`: what counts towards the fee: the advance, minus the part of it
 *   booked as workshop costs (6.4), plus the payments after closing.
 * - `owed`: still to be paid to the instructor; `toReturn`: received above the
 *   fee (e.g. the advance of a cancelled workshop, to be returned, 6.4 / 7.3).
 */
export type EarningsInput = {
  cancelled: boolean
  /** `closed_totals.instructorFee` once the books are closed, else null. */
  closedFee: number | null
  contract: { feeType: "fixed" | "per_participant"; feeAmount: number } | null
  participants: number
  /** Advance paid to the instructor, net of advances returned. */
  advancePaid: number
  /** The part of the advance booked as workshop costs. */
  advanceForCosts: number
  /** Payments of the fee after closing. */
  payments: number
}

export type Earnings = { fee: number; received: number; owed: number; toReturn: number }

export function workshopEarnings(i: EarningsInput): Earnings {
  const fee =
    i.closedFee ??
    instructorFee(i.cancelled, i.contract && { type: i.contract.feeType, amount: i.contract.feeAmount }, i.participants)
  const received = i.advancePaid - i.advanceForCosts + i.payments
  return { fee, received, owed: Math.max(0, fee - received), toReturn: Math.max(0, received - fee) }
}
