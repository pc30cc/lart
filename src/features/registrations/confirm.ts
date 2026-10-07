import "server-only"

import type { Tx } from "@/db"

/**
 * Turning a pending registration into a paid, confirmed one. SIGNATURES ARE
 * FIXED (the online payment callback and the admin's "record payment" both
 * call it); the registration engineer replaces the bodies.
 */
export type PaymentProvider = "iyzico" | "paytr" | "manual" | "test"

export type ConfirmInput = {
  registrationId: string
  provider: PaymentProvider
  /** The gateway's payment id (needed for refunds); null for manual payments. */
  paymentRef: string | null
  /** Amount actually paid, in kuruş; must equal the registration amount. */
  amount: number
  paidAt: Date
  /** The admin who recorded a manual payment; null for online payments. */
  createdBy: string | null
}

export type ConfirmResult =
  | { ok: true; registrationId: string; alreadyConfirmed: boolean }
  | {
      ok: false
      /**
       * not_found / amount_mismatch: refused. not_pending (cancelled or expired) and
       * full / closed (paid after the seat hold ran out): the money was taken but the
       * seat cannot be given: the registration is cancelled with a full refund owed.
       */
      reason: "not_found" | "amount_mismatch" | "not_pending" | "full" | "closed"
    }

/**
 * In one transaction (the caller's `tx`): lock the course row, then the
 * registration; check it can still be confirmed; set confirmed + paid_at +
 * payment provider/ref; post the ledger payment (postRegistrationPayment).
 * Idempotent: a second call for the same payment returns alreadyConfirmed.
 * Emails are sent by the caller after commit (sendRegistrationConfirmed).
 */
export async function confirmPaidRegistration(tx: Tx, input: ConfirmInput): Promise<ConfirmResult> {
  void tx
  void input
  throw new Error("not implemented")
}

/** After commit: the registration_confirmed email in the member's language. */
export async function sendRegistrationConfirmed(registrationId: string): Promise<boolean> {
  void registrationId
  throw new Error("not implemented")
}
