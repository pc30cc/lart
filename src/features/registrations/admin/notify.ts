import "server-only"
import { eq } from "drizzle-orm"

import { db } from "@/db"
import { admins, courses, members, registrations } from "@/db/schema"
import { locales, type AppLocale } from "@/i18n/routing"
import { sendEmail } from "@/lib/email"
import { formatDate, formatTimeRange, localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { getSetting } from "@/lib/settings"
import type { CancelledRegistration, ChangedRefund } from "./payments"
import type { PaymentMethod } from "./schema"

/**
 * Emails to the member after an admin recorded a payment, cancelled a
 * registration, changed its refund or paid a refund back. Sent after the commit, in the member's
 * language (`members.locale`); a failed send is logged by `sendEmail` and
 * never undoes the change. Each has an idempotency key, so a retry never
 * emails twice.
 */

/** The member's language when it is one of ours, else the default language. */
export function memberLocale(value: string | null | undefined, fallback: AppLocale): AppLocale {
  return (locales as readonly string[]).includes(value ?? "") ? (value as AppLocale) : fallback
}

async function load(registrationId: string) {
  const [row] = await db
    .select({
      amount: registrations.amount,
      refundAmount: registrations.refundAmount,
      participantName: registrations.participantName,
      member: { name: members.name, email: members.email, locale: members.locale },
      course: { title: courses.title, venue: courses.venue, startsAt: courses.startsAt, endsAt: courses.endsAt },
    })
    .from(registrations)
    .innerJoin(members, eq(members.id, registrations.memberId))
    .innerJoin(courses, eq(courses.id, registrations.courseId))
    .where(eq(registrations.id, registrationId))
    .limit(1)
  if (!row) return null
  return { ...row, locale: memberLocale(row.member.locale, await getSetting("defaultLocale")) }
}

/** "We've received your payment": paid, place confirmed. */
export async function sendPaymentReceived(registrationId: string, method: PaymentMethod): Promise<boolean> {
  const row = await load(registrationId)
  if (!row) return false
  const { locale, course } = row
  const sent = await sendEmail({
    to: row.member.email,
    template: "payment_received",
    locale,
    idempotencyKey: `payment_received:${registrationId}`,
    props: {
      name: row.member.name,
      workshopTitle: localized(course.title, locale),
      amount: formatLira(row.amount, locale),
      method,
      date: formatDate(course.startsAt, locale, "full"),
      time: formatTimeRange(course.startsAt, course.endsAt, locale),
      venue: localized(course.venue, locale),
      accountUrl: `/${locale}/account/registrations/${registrationId}`,
    },
  })
  return sent.ok
}

/** "Your registration is cancelled" (by us: neutral wording), with the refund when something was paid. */
export async function sendRegistrationCancelled(cancelled: CancelledRegistration): Promise<boolean> {
  const row = await load(cancelled.registrationId)
  if (!row) return false
  const { locale } = row
  const sent = await sendEmail({
    to: row.member.email,
    template: "registration_cancelled",
    locale,
    idempotencyKey: `registration_cancelled:${cancelled.registrationId}`,
    props: {
      name: row.member.name,
      workshopTitle: localized(row.course.title, locale),
      // Left out when nothing was paid: the email then has no refund line.
      ...(cancelled.paid > 0 ? { refundAmount: formatLira(cancelled.refund, locale) } : {}),
      refundPercent: cancelled.percent,
      // An admin cancelled it: not "as you asked".
      byUs: true,
      workshopsUrl: `/${locale}/workshops`,
    },
  })
  return sent.ok
}

/** The share of the payment a refund is, for the email's wording: 100 only when it is all of it, at least 1 when it is something. */
export function sharePercent(refund: number, paid: number): number {
  if (paid <= 0 || refund <= 0) return 0
  return refund >= paid ? 100 : Math.max(1, Math.floor((refund * 100) / paid))
}

/**
 * The admin changed the refund of a cancelled registration: the member gets
 * "Your registration is cancelled" again with the new refund (when there is
 * one), and when a refund is owed where none was, every active super admin
 * gets "A refund needs paying", as after a member's own cancellation. The
 * keys carry the amounts, so a second change is a new email and a retry of
 * the same one is not. Returns how many emails went out.
 */
export async function sendRefundChanged(changed: ChangedRefund): Promise<number> {
  if (changed.to === changed.from) return 0
  const row = await load(changed.registrationId)
  if (!row) return 0
  const { locale } = row
  let sent = 0

  if (changed.to > 0) {
    const toMember = await sendEmail({
      to: row.member.email,
      template: "registration_cancelled",
      locale,
      idempotencyKey: `registration_cancelled:${changed.registrationId}:refund:${changed.from}:${changed.to}`,
      props: {
        name: row.member.name,
        workshopTitle: localized(row.course.title, locale),
        refundAmount: formatLira(changed.to, locale),
        refundPercent: sharePercent(changed.to, changed.paid),
        byUs: true,
        workshopsUrl: `/${locale}/workshops`,
      },
    })
    if (toMember.ok) sent++
  }

  if (changed.from === 0 && changed.to > 0) {
    const adminLocale = await getSetting("defaultLocale")
    const team = await db.select({ id: admins.id, name: admins.name, email: admins.email }).from(admins).where(eq(admins.active, true))
    for (const admin of team) {
      const result = await sendEmail({
        to: admin.email,
        template: "refund_due",
        locale: adminLocale,
        idempotencyKey: `refund_due:${changed.registrationId}:${admin.id}:${changed.to}`,
        props: {
          adminName: admin.name,
          participantName: row.participantName,
          workshopTitle: localized(row.course.title, adminLocale),
          amount: formatLira(changed.to, adminLocale),
          url: `/${adminLocale}/admin/money/refunds`,
        },
      })
      if (result.ok) sent++
    }
  }
  return sent
}

/** "Your refund is on its way": the admin paid it back. */
export async function sendRefundSent(registrationId: string): Promise<boolean> {
  const row = await load(registrationId)
  if (!row?.refundAmount) return false
  const { locale } = row
  const sent = await sendEmail({
    to: row.member.email,
    template: "refund_sent",
    locale,
    idempotencyKey: `refund_sent:${registrationId}`,
    props: {
      name: row.member.name,
      workshopTitle: localized(row.course.title, locale),
      amount: formatLira(row.refundAmount, locale),
      workshopsUrl: `/${locale}/workshops`,
    },
  })
  return sent.ok
}
