/**
 * The super admin's registration forms and lists (client-safe): record a
 * payment, cancel a registration, mark a refund as paid back, and the table
 * filters of the workshop's registrations and of the refunds list.
 */
import { z } from "zod"

import { kurus, uuid } from "@/components/admin/form/schemas"
import { entryDate } from "@/features/money/schema"

/** How a registration was paid: cash, bank transfer, or the workshop's online payment link. */
export const paymentMethods = ["cash", "transfer", "online"] as const
export type PaymentMethod = (typeof paymentMethods)[number]

/** How a refund was paid back by hand. */
export const refundMethods = ["cash", "transfer"] as const

/**
 * "Record payment": `amount` is the amount the admin saw and received; the
 * server only accepts it when it is exactly the registration's amount (no
 * part payments). `paidOn` is the day it was paid (Istanbul), not in the future.
 */
export const recordPaymentSchema = z.object({
  id: uuid(),
  method: z.enum(paymentMethods, { error: "workshops.registrations.errors.chooseMethod" }),
  amount: kurus({ min: 1 }),
  paidOn: entryDate(),
})
export type RecordPaymentValues = z.input<typeof recordPaymentSchema>

/** "Cancel registration": refund under the terms (100 / 50 / 0 % by the time left) or in full. Unpaid: nothing to refund. */
export const cancelRegistrationSchema = z.object({
  id: uuid(),
  refund: z.enum(["terms", "full"]),
})
export type CancelRegistrationValues = z.input<typeof cancelRegistrationSchema>

/** "Mark as refunded": paid back by hand (cash or transfer) on that day. */
export const markRefundedSchema = z.object({
  id: uuid(),
  method: z.enum(refundMethods, { error: "money.refunds.errors.chooseMethod" }),
  refundedOn: entryDate(),
})
export type MarkRefundedValues = z.input<typeof markRefundedSchema>

/** Filters of a workshop's registrations: paid, not paid yet, cancelled. */
export const registrationViews = ["unpaid", "paid", "cancelled"] as const
export type RegistrationView = (typeof registrationViews)[number]

export const registrationTable = {
  sort: ["createdAt", "participant"] as const,
  filters: { status: registrationViews },
}

/** The refunds list: still to pay back (default) or already paid back. */
export const refundViews = ["owed", "refunded"] as const
export const refundTable = {
  sort: ["cancelledAt", "amount"] as const,
  filters: { view: refundViews },
}
