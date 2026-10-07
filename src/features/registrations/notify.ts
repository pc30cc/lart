import "server-only"
import { eq } from "drizzle-orm"

import { db } from "@/db"
import { admins, courses, members, registrations } from "@/db/schema"
import { paymentWays } from "@/emails/payment"
import { sendEmail } from "@/lib/email"
import { formatDate, formatTimeRange, localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { getSetting } from "@/lib/settings"
import type { Cancelled } from "./register"
import { safePaymentUrl } from "./schema"

/**
 * The emails of registering and cancelling, sent after the commit (never
 * inside the transaction): each loads what it needs and writes in the
 * member's language (`members.locale`). They never throw for a failed send
 * (`sendEmail` logs it); the result says what went out.
 */

async function loadRegistration(id: string) {
  const [row] = await db
    .select({
      participantName: registrations.participantName,
      status: registrations.status,
      amount: registrations.amount,
      member: { name: members.name, email: members.email, locale: members.locale },
      course: {
        id: courses.id,
        slug: courses.slug,
        title: courses.title,
        venue: courses.venue,
        startsAt: courses.startsAt,
        endsAt: courses.endsAt,
        paymentUrl: courses.paymentUrl,
      },
    })
    .from(registrations)
    .innerJoin(members, eq(members.id, registrations.memberId))
    .innerJoin(courses, eq(courses.id, registrations.courseId))
    .where(eq(registrations.id, id))
    .limit(1)
  return row ?? null
}

/**
 * "Your place is reserved" (registration_received) with the payment ways that
 * are switched on, or for a free workshop "Registration confirmed".
 */
export async function sendRegistrationReceived(registrationId: string): Promise<boolean> {
  const row = await loadRegistration(registrationId)
  if (!row) return false
  const { member, course } = row
  const locale = member.locale
  const details = {
    name: member.name,
    workshopTitle: localized(course.title, locale),
    date: formatDate(course.startsAt, locale, "full"),
    time: formatTimeRange(course.startsAt, course.endsAt, locale),
    venue: localized(course.venue, locale),
    amount: formatLira(row.amount, locale),
  }

  if (row.status === "confirmed" && row.amount === 0) {
    const sent = await sendEmail({
      to: member.email,
      template: "registration_confirmed",
      locale,
      props: { ...details, workshopUrl: `/${locale}/workshops/${course.slug}` },
    })
    return sent.ok
  }

  const sent = await sendEmail({
    to: member.email,
    template: "registration_received",
    locale,
    idempotencyKey: `registration_received:${registrationId}`,
    props: {
      ...details,
      participantName: row.participantName,
      accountUrl: `/${locale}/account/registrations/${registrationId}`,
      ...paymentWays(await getSetting("payment"), safePaymentUrl(course.paymentUrl), locale),
    },
  })
  return sent.ok
}

/**
 * After the member cancelled: "Your registration is cancelled" (with the
 * refund, when something was paid) and, when a refund is owed, "A refund
 * needs paying" to every active super admin. Returns how many emails went out.
 */
export async function sendRegistrationCancelled(cancelled: Cancelled): Promise<number> {
  const row = await loadRegistration(cancelled.id)
  if (!row) return 0
  const { member, course } = row
  const locale = member.locale
  let sent = 0

  const toMember = await sendEmail({
    to: member.email,
    template: "registration_cancelled",
    locale,
    idempotencyKey: `registration_cancelled:${cancelled.id}`,
    props: {
      name: member.name,
      workshopTitle: localized(course.title, locale),
      // Left out when nothing was paid: the email then has no refund line.
      ...(cancelled.paid > 0 ? { refundAmount: formatLira(cancelled.refund, locale) } : {}),
      refundPercent: cancelled.percent,
      workshopsUrl: `/${locale}/workshops`,
    },
  })
  if (toMember.ok) sent++

  if (cancelled.refund > 0) {
    const adminLocale = await getSetting("defaultLocale")
    const team = await db
      .select({ id: admins.id, name: admins.name, email: admins.email })
      .from(admins)
      .where(eq(admins.active, true))
    for (const admin of team) {
      const result = await sendEmail({
        to: admin.email,
        template: "refund_due",
        locale: adminLocale,
        idempotencyKey: `refund_due:${cancelled.id}:${admin.id}`,
        props: {
          adminName: admin.name,
          participantName: row.participantName,
          workshopTitle: localized(course.title, adminLocale),
          amount: formatLira(cancelled.refund, adminLocale),
          url: `/${adminLocale}/admin/workshops/${course.id}/registrations`,
        },
      })
      if (result.ok) sent++
    }
  }
  return sent
}
