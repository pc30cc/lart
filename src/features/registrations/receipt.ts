import "server-only"
import { and, eq, isNull } from "drizzle-orm"

import { db } from "@/db"
import { adminNotifications, registrations } from "@/db/schema"

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
