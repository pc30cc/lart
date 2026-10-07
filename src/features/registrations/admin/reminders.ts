import "server-only"
import { createHash } from "node:crypto"
import { and, eq, gt, inArray, isNull, lte, ne } from "drizzle-orm"

import { db } from "@/db"
import { courses, members, registrations } from "@/db/schema"
import { paymentWays } from "@/emails/payment"
import { localeHref } from "@/i18n/links"
import { sendEmail } from "@/lib/email"
import { formatDate, formatTimeRange, localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { getSetting } from "@/lib/settings"
import { safePaymentUrl } from "../schema"
import { memberLocale } from "./notify"

/**
 * The day-before reminder (scheduled job, `pnpm jobs`): every member with an
 * active registration (paid or not yet paid) in a workshop that starts within
 * the next 24 hours gets one `workshop_reminder` in their language, then
 * those registrations get `reminder_sent_at`. One email per member and
 * workshop per batch of registrations: a parent who registered two children
 * gets one email, and a registration added after their reminder went out
 * gets a reminder of its own on the next run. When something is still unpaid, the email says
 * how much (`amount`) and shows the ways to pay that are switched on (cash,
 * bank transfer, the workshop's payment link), as `registration_received` does.
 *
 * Safe to run often and in parallel: a member is handled by one run at a
 * time (their row is locked FOR NO KEY UPDATE SKIP LOCKED: a parallel run
 * skips them; then their registrations FOR UPDATE), registrations are
 * marked only when the email went out (otherwise the next run tries again),
 * and the Resend idempotency key stops a retry from emailing twice. The key
 * names the exact registrations the email covers (a short hash of their ids):
 * a retry of the same email has the same key, while a later registration's
 * reminder has a new one (Resend refuses a key reused with other content). It
 * also names the start time: a reminder for a new date (reminder_sent_at is
 * reset when startsAt changes) is not blocked by the one for the old date.
 */

const HOUR = 3_600_000

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
        .select({
          id: registrations.id,
          status: registrations.status,
          amount: registrations.amount,
          participantName: registrations.participantName,
        })
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
          paymentUrl: courses.paymentUrl,
        })
        .from(courses)
        .where(and(eq(courses.id, courseId), ne(courses.status, "cancelled"), isNull(courses.cancelledAt), gt(courses.startsAt, now)))
      if (!course) return false

      const locale = memberLocale(member.locale, fallback)
      const unpaid = mine.filter((r) => r.status === "pending" && r.amount > 0)
      const toPay = unpaid.reduce((total, r) => total + r.amount, 0)
      const bring = localized(course.bring, locale)
      const names = [...new Set(unpaid.map((r) => r.participantName))].join(", ")
      // The registrations this email is about: the same set gives the same key, a later one a new key.
      const batch = createHash("sha256")
        .update(mine.map((r) => r.id).sort().join(","))
        .digest("hex")
        .slice(0, 16)

      const result = await sendEmail({
        to: member.email,
        template: "workshop_reminder",
        locale,
        // The start time too: when the date changes, reminder_sent_at is reset and the new reminder needs its own key.
        idempotencyKey: `workshop_reminder:${courseId}:${memberId}:${course.startsAt.getTime()}:${batch}`,
        props: {
          name: member.name,
          workshopTitle: localized(course.title, locale),
          date: formatDate(course.startsAt, locale, "full"),
          time: formatTimeRange(course.startsAt, course.endsAt, locale),
          venue: localized(course.venue, locale),
          ...(bring ? { bring: bring.slice(0, 500) } : {}),
          workshopUrl: await localeHref(locale, `/workshops/${course.slug}`),
          ...(toPay > 0
            ? {
                amount: formatLira(toPay, locale),
                participantName: names.length > 300 ? `${names.slice(0, 299)}…` : names,
                ...paymentWays(payment, safePaymentUrl(course.paymentUrl), locale),
              }
            : {}),
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
