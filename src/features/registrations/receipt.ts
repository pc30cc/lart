import "server-only"
import { and, eq, isNull } from "drizzle-orm"

import { db } from "@/db"
import { adminNotifications, courses, registrations } from "@/db/schema"
import { UserError } from "@/lib/errors"
import { getSetting } from "@/lib/settings"
import { paymentWayNames, type PaymentWayName } from "./schema"

/**
 * The bank transfer receipt a member sends for their own registration: only
 * one not paid yet, not cancelled and with something to pay. Kept with the
 * registration (a new one replaces it; the old file's path is returned to be
 * removed) and the panel's bell tells the super admins.
 */
export async function attachReceipt(memberId: string, registrationId: string, path: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ receiptPath: registrations.receiptPath })
      .from(registrations)
      .where(
        and(
          eq(registrations.id, registrationId),
          eq(registrations.memberId, memberId),
          eq(registrations.status, "pending"),
          isNull(registrations.paidAt),
        ),
      )
      .for("update")
    if (!row) return null
    await tx.update(registrations).set({ receiptPath: path, receiptAt: now }).where(eq(registrations.id, registrationId))
    await tx.insert(adminNotifications).values({ kind: "receipt", registrationId })
    return { previous: row.receiptPath }
  })
}

/** Whether the member may send a receipt for this registration now (checked before the upload is read). */
export async function canAttachReceipt(memberId: string, registrationId: string) {
  const [row] = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.memberId, memberId),
        eq(registrations.status, "pending"),
        isNull(registrations.paidAt),
      ),
    )
  return Boolean(row)
}

/**
 * The member changes how they will pay (e.g. from a bank transfer to cash at
 * the workshop): only their own registration waiting for payment, and only
 * to one of the ways switched on. A receipt already sent stays with it.
 */
export async function changePaymentChoice(memberId: string, registrationId: string, choice: PaymentWayName) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ paymentChoice: registrations.paymentChoice, paymentUrl: courses.paymentUrl })
      .from(registrations)
      .innerJoin(courses, eq(courses.id, registrations.courseId))
      .where(
        and(
          eq(registrations.id, registrationId),
          eq(registrations.memberId, memberId),
          eq(registrations.status, "pending"),
          isNull(registrations.paidAt),
        ),
      )
      .for("update", { of: registrations })
    if (!row) throw new UserError("registration.errors.cannotChangeWay")
    if (!paymentWayNames(await getSetting("payment"), row.paymentUrl).includes(choice)) {
      throw new UserError("registration.errors.cannotChangeWay")
    }
    if (row.paymentChoice === choice) return { changed: false }
    await tx.update(registrations).set({ paymentChoice: choice }).where(eq(registrations.id, registrationId))
    return { changed: true }
  })
}
