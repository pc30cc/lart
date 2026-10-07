import "server-only"
import { and, count, eq, inArray, isNull, lte } from "drizzle-orm"

import { db } from "@/db"
import { admins, courses, registrations } from "@/db/schema"
import { workshopAdminPath } from "@/features/contracts/notify"
import { sendEmail } from "@/lib/email"
import { formatDateTime, localized } from "@/lib/format"
import { getSetting } from "@/lib/settings"

/**
 * The go / no-go reminder (scheduled job, `pnpm jobs`): for every published
 * workshop whose decision time has passed and whose admins were not told yet,
 * email "decision due" to every active super admin, then set
 * `decision_notified_at`. Safe to run often and in parallel: each workshop is
 * locked while it is handled (others skip it), it is marked only when every
 * email went out (otherwise the next run tries again), and Resend
 * idempotency keys stop a retry from emailing the same admin twice.
 */
export async function notifyDueDecisions(now: Date = new Date()): Promise<{ due: number; notified: number }> {
  const due = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.status, "published"), lte(courses.decisionAt, now), isNull(courses.decisionNotifiedAt)))
  if (!due.length) return { due: 0, notified: 0 }

  const locale = await getSetting("defaultLocale")
  const team = await db.select({ id: admins.id, name: admins.name, email: admins.email }).from(admins).where(eq(admins.active, true))

  let notified = 0
  for (const { id } of due) {
    const done = await db.transaction(async (tx) => {
      const [course] = await tx
        .select({ title: courses.title, decisionAt: courses.decisionAt, minCapacity: courses.minCapacity })
        .from(courses)
        .where(and(eq(courses.id, id), eq(courses.status, "published"), isNull(courses.decisionNotifiedAt)))
        .for("update", { skipLocked: true })
      if (!course) return false // handled by a parallel run, or changed meanwhile

      // Everyone registered counts, paid or not yet (many pay in cash at the workshop), as at the go decision.
      const [{ registered }] = await tx
        .select({ registered: count() })
        .from(registrations)
        .where(and(eq(registrations.courseId, id), inArray(registrations.status, ["pending", "confirmed"])))

      let allSent = true
      for (const admin of team) {
        const result = await sendEmail({
          to: admin.email,
          template: "decision_due",
          locale,
          idempotencyKey: `decision_due:${id}:${admin.id}:${course.decisionAt.getTime()}`,
          props: {
            adminName: admin.name,
            workshopTitle: localized(course.title, locale),
            registrations: registered,
            minimum: course.minCapacity,
            decisionAt: formatDateTime(course.decisionAt, locale, "long"),
            workshopUrl: workshopAdminPath(locale, id),
          },
        })
        if (!result.ok) allSent = false
      }
      if (!allSent) return false
      await tx.update(courses).set({ decisionNotifiedAt: now }).where(eq(courses.id, id))
      return true
    })
    if (done) notified++
  }
  return { due: due.length, notified }
}
