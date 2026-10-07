import "server-only"
import { and, eq, gt, inArray, isNull, lte, ne } from "drizzle-orm"
import { createTranslator } from "next-intl"

import { db } from "@/db"
import { courses, members, registrations } from "@/db/schema"
import { sendEmail } from "@/lib/email"
import { formatDate, formatTimeRange, localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { getSetting } from "@/lib/settings"
import en from "../../../../messages/en/workshops.json"
import fa from "../../../../messages/fa/workshops.json"
import tr from "../../../../messages/tr/workshops.json"
import { memberLocale } from "./notify"

/**
 * The day-before reminder (scheduled job, `pnpm jobs`): every member with an
 * active registration (paid or not yet paid) in a workshop that starts within
 * the next 24 hours gets one `workshop_reminder` in their language, then
 * those registrations get `reminder_sent_at`. A parent who registered two
 * children gets one email. When something is still unpaid and cash is on,
 * "What to bring" also says "{amount} in cash".
 *
 * Safe to run often and in parallel: a member is handled by one run at a
 * time (their row is locked FOR NO KEY UPDATE SKIP LOCKED: a parallel run
 * skips them; then their registrations FOR UPDATE), registrations are
 * marked only when the email went out (otherwise the next run tries again),
 * and the Resend idempotency key stops a retry from emailing twice.
 */

const HOUR = 3_600_000
const texts = { fa, tr, en }

/** "{amount} in cash for the workshop" in a language. */
function cashLine(locale: keyof typeof texts, amount: string): string {
  const t = createTranslator({ locale, messages: texts[locale], namespace: "registrations.reminder" })
  return t("bringCash", { amount })
}

export async function sendDayBeforeReminders(now: Date = new Date()): Promise<{ due: number; sent: number }> {
  const soon = new Date(now.getTime() + 24 * HOUR)
  // Who is due: one row per member and workshop.
  const due = await db
    .selectDistinct({ courseId: registrations.courseId, memberId: registrations.memberId })
    .from(registrations)
    .innerJoin(courses, eq(courses.id, registrations.courseId))
    .where(
      and(
        inArray(registrations.status, ["pending", "confirmed"]),
        isNull(registrations.reminderSentAt),
        inArray(courses.status, ["published", "confirmed", "awaiting_signature"]),
        isNull(courses.cancelledAt),
        gt(courses.startsAt, now),
        lte(courses.startsAt, soon),
      ),
    )
  if (!due.length) return { due: 0, sent: 0 }

  const [payment, fallback] = await Promise.all([getSetting("payment"), getSetting("defaultLocale")])
  let sent = 0
  for (const { courseId, memberId } of due) {
    const done = await db.transaction(async (tx) => {
      // One run at a time handles a member: a parallel run skips them (their row is the lock).
      const [member] = await tx
        .select({ name: members.name, email: members.email, locale: members.locale })
        .from(members)
        .where(eq(members.id, memberId))
        .for("no key update", { skipLocked: true })
      if (!member) return false // handled by a parallel run right now

      const mine = await tx
        .select({ id: registrations.id, status: registrations.status, amount: registrations.amount })
        .from(registrations)
        .where(
          and(
            eq(registrations.courseId, courseId),
            eq(registrations.memberId, memberId),
            inArray(registrations.status, ["pending", "confirmed"]),
            isNull(registrations.reminderSentAt),
          ),
        )
        .for("update")
      if (!mine.length) return false // reminded meanwhile, or cancelled

      const [course] = await tx
        .select({
          slug: courses.slug,
          title: courses.title,
          venue: courses.venue,
          bring: courses.bring,
          startsAt: courses.startsAt,
          endsAt: courses.endsAt,
        })
        .from(courses)
        .where(and(eq(courses.id, courseId), ne(courses.status, "cancelled"), isNull(courses.cancelledAt), gt(courses.startsAt, now)))
      if (!course) return false

      const locale = memberLocale(member.locale, fallback)
      const unpaid = mine.filter((r) => r.status === "pending").reduce((total, r) => total + r.amount, 0)
      // "What to bring" holds at most 500 characters: the cash line always fits.
      const cash = unpaid > 0 && payment.cash ? cashLine(locale, formatLira(unpaid, locale)) : ""
      const own = localized(course.bring, locale)
      const room = 500 - (cash ? cash.length + 3 : 0)
      const bring = [own.length > room ? `${own.slice(0, room - 1)}…` : own, cash].filter(Boolean).join(" · ")

      const result = await sendEmail({
        to: member.email,
        template: "workshop_reminder",
        locale,
        idempotencyKey: `workshop_reminder:${courseId}:${memberId}`,
        props: {
          name: member.name,
          workshopTitle: localized(course.title, locale),
          date: formatDate(course.startsAt, locale, "full"),
          time: formatTimeRange(course.startsAt, course.endsAt, locale),
          venue: localized(course.venue, locale),
          ...(bring ? { bring } : {}),
          workshopUrl: `/${locale}/workshops/${course.slug}`,
        },
      })
      if (!result.ok) return false
      await tx
        .update(registrations)
        .set({ reminderSentAt: now })
        .where(and(inArray(registrations.id, mine.map((r) => r.id)), isNull(registrations.reminderSentAt)))
      return true
    })
    if (done) sent++
  }
  return { due: due.length, sent }
}
