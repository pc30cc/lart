import "server-only"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db"
import { courses, registrations } from "@/db/schema"
import { paymentWays } from "@/emails/payment"
import { requireMember } from "@/lib/auth/member"
import { localized } from "@/lib/format"
import { getSetting } from "@/lib/settings"
import { safePaymentUrl } from "./schema"

/**
 * The signed-in member's own registrations ("My workshops"). Every read calls
 * `requireMember()` and is scoped to that member: an id from the address bar
 * that belongs to someone else is simply not found.
 */

const columns = {
  id: registrations.id,
  participantName: registrations.participantName,
  status: registrations.status,
  amount: registrations.amount,
  paymentMethod: registrations.paymentMethod,
  paidAt: registrations.paidAt,
  cancelledAt: registrations.cancelledAt,
  refundAmount: registrations.refundAmount,
  refundedAt: registrations.refundedAt,
  photoConsent: registrations.photoConsent,
  videoConsent: registrations.videoConsent,
  termsAcceptedAt: registrations.termsAcceptedAt,
  createdAt: registrations.createdAt,
  course: {
    id: courses.id,
    slug: courses.slug,
    status: courses.status,
    title: courses.title,
    venue: courses.venue,
    startsAt: courses.startsAt,
    endsAt: courses.endsAt,
    closedAt: courses.closedAt,
    paymentUrl: courses.paymentUrl,
    publishedAt: courses.publishedAt,
  },
}

type Row = Awaited<ReturnType<typeof selectMine>>[number]

function selectMine(memberId: string, id?: string) {
  return db
    .select(columns)
    .from(registrations)
    .innerJoin(courses, eq(courses.id, registrations.courseId))
    .where(and(eq(registrations.memberId, memberId), id ? eq(registrations.id, id) : undefined))
    .orderBy(desc(courses.startsAt), desc(registrations.createdAt))
}

/** Text in the page language; the workshop page link only for a workshop that was ever public. */
async function present(rows: Row[], locale: string) {
  const payment = await getSetting("payment")
  return rows.map(({ course, ...r }) => ({
    ...r,
    course: {
      id: course.id,
      slug: course.publishedAt ? course.slug : null,
      status: course.status,
      title: localized(course.title, locale),
      venue: localized(course.venue, locale),
      startsAt: course.startsAt,
      endsAt: course.endsAt,
      closedAt: course.closedAt,
    },
    /** How to pay (the ways switched on in the settings); only shown while not paid yet. */
    ways: paymentWays(payment, safePaymentUrl(course.paymentUrl), locale),
  }))
}

/** All of the member's registrations, latest workshop first. */
export async function listMyRegistrations(locale: string) {
  const { member } = await requireMember()
  return present(await selectMine(member.id), locale)
}

/** One of the member's registrations, or null (also for someone else's id). */
export async function getMyRegistration(id: string, locale: string) {
  const { member } = await requireMember()
  if (!z.uuid().safeParse(id).success) return null
  const [row] = await present(await selectMine(member.id, id), locale)
  return row ?? null
}

export type MyRegistration = Awaited<ReturnType<typeof listMyRegistrations>>[number]
