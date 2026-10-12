import "server-only"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db"
import { courses, registrations } from "@/db/schema"
import { chosenWay, paymentWays } from "@/emails/payment"
import { requireMember } from "@/lib/auth/member"
import { localized } from "@/lib/format"
import { getSetting } from "@/lib/settings"
import { publicUrls } from "@/lib/storage"
import { workshopTerms } from "./public"
import { paymentWayNames, safePaymentUrl } from "./schema"
import { forDay } from "@/features/workshops/days"

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
  paymentChoice: registrations.paymentChoice,
  receiptPath: registrations.receiptPath,
  receiptAt: registrations.receiptAt,
  paidAt: registrations.paidAt,
  cancelledAt: registrations.cancelledAt,
  refundAmount: registrations.refundAmount,
  refundedAt: registrations.refundedAt,
  photoConsent: registrations.photoConsent,
  videoConsent: registrations.videoConsent,
  termsAcceptedAt: registrations.termsAcceptedAt,
  createdAt: registrations.createdAt,
  day: registrations.day,
  course: {
    id: courses.id,
    slug: courses.slug,
    status: courses.status,
    title: courses.title,
    venue: courses.venue,
    startsAt: courses.startsAt,
    days: courses.days,
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
  const [payment, url] = await Promise.all([getSetting("payment"), publicUrls()])
  return rows.map(({ course, receiptPath, ...r }) => ({
    ...r,
    /** The transfer receipt they sent (its CDN address), or null. */
    receiptUrl: url(receiptPath),
    // Several days: the workshop as their day (its date and hours, cancelling and refunds counted to it).
    course: forDay(
      {
        id: course.id,
        slug: course.publishedAt ? course.slug : null,
        status: course.status,
        title: localized(course.title, locale),
        venue: localized(course.venue, locale),
        startsAt: course.startsAt,
        days: course.days,
        endsAt: course.endsAt,
        closedAt: course.closedAt,
      },
      r.day,
    ),
    /** How to pay: the way they chose when registering (else every way switched on); only shown while not paid yet. */
    ways: chosenWay(paymentWays(payment, safePaymentUrl(course.paymentUrl), locale), r.paymentChoice),
    /** The other ways on, to change to ("Pay another way"); none before a way was chosen. */
    otherWays: r.paymentChoice ? paymentWayNames(payment, course.paymentUrl).filter((w) => w !== r.paymentChoice) : [],
  }))
}

/** All of the member's registrations, latest workshop first. */
export async function listMyRegistrations(locale: string) {
  const { member } = await requireMember()
  return present(await selectMine(member.id), locale)
}

/**
 * One of the member's registrations, or null (also for someone else's id).
 * `terms`: the registration terms of the template they accepted, in the page
 * language, so the refund rule can still be read later.
 */
export async function getMyRegistration(id: string, locale: string) {
  const { member } = await requireMember()
  if (!z.uuid().safeParse(id).success) return null
  const [row] = await present(await selectMine(member.id, id), locale)
  if (!row) return null
  const [accepted] = await db
    .select({ templateId: registrations.termsTemplateId })
    .from(registrations)
    .where(and(eq(registrations.id, id), eq(registrations.memberId, member.id)))
  const terms = accepted ? await workshopTerms(accepted.templateId, locale) : null
  return { ...row, terms: terms?.text ?? null }
}

export type MyRegistration = Awaited<ReturnType<typeof listMyRegistrations>>[number]
