import "server-only"
import { desc, eq, gt, sql } from "drizzle-orm"

import { db } from "@/db"
import { adminNotifications, admins, courses, registrations } from "@/db/schema"
import { localized } from "@/lib/format"

/** How many the bell's list shows (the latest). */
export const NOTIFICATION_LIST = 15

export type AdminNotification = {
  id: string
  kind: "registration" | "receipt" | "workshop"
  createdAt: Date
  /** The registration's participant ("" for a workshop's notification). */
  participantName: string
  workshopTitle: string
  courseId: string
  /** How they said they will pay (cash / transfer / online), or null. */
  paymentChoice: string | null
  /** Paid since (the bell then says so). */
  paid: boolean
  cancelled: boolean
}

/**
 * The panel's bell for one super admin, in `locale`: the latest notifications
 * (new registrations, transfer receipts) and how many came after they last
 * opened it.
 */
export async function listAdminNotifications(adminId: string, locale: string) {
  const [me] = await db.select({ seenAt: admins.notificationsSeenAt }).from(admins).where(eq(admins.id, adminId))
  const seenAt = me?.seenAt ?? null
  const [rows, [{ unread }]] = await Promise.all([
    db
      .select({
        id: adminNotifications.id,
        kind: adminNotifications.kind,
        createdAt: adminNotifications.createdAt,
        participantName: registrations.participantName,
        paymentChoice: registrations.paymentChoice,
        paidAt: registrations.paidAt,
        status: registrations.status,
        courseId: courses.id,
        title: courses.title,
        telegramPostedAt: courses.telegramPostedAt,
      })
      .from(adminNotifications)
      .leftJoin(registrations, eq(registrations.id, adminNotifications.registrationId))
      // The registration's workshop, or the notification's own.
      .innerJoin(courses, eq(courses.id, sql`coalesce(${registrations.courseId}, ${adminNotifications.courseId})`))
      .orderBy(desc(adminNotifications.createdAt))
      .limit(NOTIFICATION_LIST),
    db
      .select({ unread: sql<number>`count(*)::int` })
      .from(adminNotifications)
      .where(seenAt ? gt(adminNotifications.createdAt, seenAt) : undefined),
  ])
  const items: AdminNotification[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as AdminNotification["kind"],
    createdAt: r.createdAt,
    participantName: r.participantName ?? "",
    workshopTitle: localized(r.title, locale),
    courseId: r.courseId,
    paymentChoice: r.paymentChoice,
    // A workshop's: "done" once sent to the channel.
    paid: r.kind === "workshop" ? r.telegramPostedAt !== null : r.paidAt !== null,
    cancelled: r.status === "cancelled",
  }))
  return { unread, items }
}

/** The super admin opened the bell: everything so far counts as read. */
export async function markNotificationsSeen(adminId: string, now = new Date()) {
  await db.update(admins).set({ notificationsSeenAt: now }).where(eq(admins.id, adminId))
}
