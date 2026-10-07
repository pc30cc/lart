"use server"

import { refresh, revalidatePath } from "next/cache"
import { after } from "next/server"

import { db } from "@/db"
import { paymentSettingsSchema } from "@/features/settings/payments"
import { adminAction } from "@/lib/action"
import { changes } from "@/lib/audit"
import { errorForLog } from "@/lib/errors"
import { getSetting, setSetting } from "@/lib/settings"
import { sendPaymentReceived, sendRefundSent, sendRegistrationCancelled } from "./notify"
import { cancelRegistration, momentOf, recordPayment, recordRefund } from "./payments"
import { cancelRegistrationSchema, markRefundedSchema, recordPaymentSchema } from "./schema"

/**
 * The super admin's registration actions: record a payment, cancel a
 * registration, mark a refund as paid back, and the payment settings. Each
 * change and its audit entry share one transaction; the member's email goes
 * out after the response (`after`), in the member's language.
 */

const logFailure = (what: string) => (err: unknown) => console.error(`[registrations] ${what} failed`, errorForLog(err))

/** Money moved: the workshop pages, the wallet and the dashboard show it. */
function revalidate() {
  revalidatePath("/[locale]/admin", "layout")
  refresh()
}

/** "Record payment" of a registration not paid yet (cash, bank transfer or the online link). */
export const recordPaymentAction = adminAction(recordPaymentSchema, async ({ id, method, amount, paidOn }, ctx) => {
  await db.transaction(async (tx) => {
    const paid = await recordPayment(tx, { registrationId: id, method, amount, paidAt: momentOf(paidOn), createdBy: ctx.admin.id })
    await ctx.audit(
      {
        action: "registration.payment",
        entity: "registration",
        entityId: id,
        data: { courseId: paid.courseId, method, amount: paid.amount, paidOn, transactionId: paid.transactionId },
      },
      tx,
    )
  })
  after(() => sendPaymentReceived(id, method).catch(logFailure("payment email")))
  revalidate()
  return { id, method }
})

/** Cancel a registration; a paid one is owed its refund (under the terms, or in full). */
export const cancelRegistrationAction = adminAction(cancelRegistrationSchema, async ({ id, refund }, ctx) => {
  const cancelled = await db.transaction(async (tx) => {
    const cancelled = await cancelRegistration(tx, { registrationId: id, refund })
    await ctx.audit(
      {
        action: "registration.cancel",
        entity: "registration",
        entityId: id,
        data: {
          courseId: cancelled.courseId,
          paid: cancelled.paid,
          refundChoice: refund,
          refundPercent: cancelled.percent,
          refundAmount: cancelled.refund,
        },
      },
      tx,
    )
    return cancelled
  })
  after(() => sendRegistrationCancelled(cancelled).catch(logFailure("cancellation email")))
  revalidate()
  return { id, refund: cancelled.refund }
})

/** A refund owed was paid back by hand: posted to the ledger once, then "Your refund is on its way". */
export const markRefundedAction = adminAction(markRefundedSchema, async ({ id, method, refundedOn }, ctx) => {
  const refunded = await db.transaction(async (tx) => {
    const refunded = await recordRefund(tx, { registrationId: id, refundedAt: momentOf(refundedOn), createdBy: ctx.admin.id })
    await ctx.audit(
      {
        action: "registration.refund",
        entity: "registration",
        entityId: id,
        data: { courseId: refunded.courseId, amount: refunded.amount, method, refundedOn, transactionId: refunded.transactionId },
      },
      tx,
    )
    return refunded
  })
  after(() => sendRefundSent(id).catch(logFailure("refund email")))
  revalidate()
  return { id, amount: refunded.amount }
})

/** Settings → Payments: which ways to pay are on, the bank account and the notes. */
export const savePaymentSettings = adminAction(paymentSettingsSchema, async (input, ctx) => {
  const before = await getSetting("payment")
  const diff = changes(before, input)
  if (Object.keys(diff).length === 0) return { changed: false }
  await db.transaction(async (tx) => {
    await setSetting("payment", input, tx)
    await ctx.audit({ action: "setting.update", entity: "setting", entityId: "payment", data: diff }, tx)
  })
  revalidate()
  return { changed: true }
})
