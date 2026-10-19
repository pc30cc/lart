import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import type { z } from "zod"

import { db } from "@/db"
import { adminNotifications, courses, registrations } from "@/db/schema"
import { UserError } from "@/lib/errors"
import { getSetting } from "@/lib/settings"
import { forDay, workshopDays } from "@/features/workshops/days"
import { seatsTakenByDay, workshopTerms } from "./public"
import {
  activeStatuses,
  cancelPreview,
  daySeatsLeft,
  MAX_ACTIVE_PER_MEMBER,
  paymentWayNames,
  registrationWindow,
  bookableSeats,
  dayDeadlines,
  sameParticipant,
  type CancelPreview,
  type registerSchema,
} from "./schema"

/**
 * Registering and cancelling, for the signed-in member (the caller passes
 * `ctx.member.id`; every query is scoped to it). Both lock the workshop row
 * first (FOR NO KEY UPDATE, the lock of `lockCourse` in features/money and of
 * payments), so two people can never take the same last seat and a payment
 * recorded at the same moment is seen. Emails go out after the commit
 * (`notify.ts`); expected refusals throw `UserError("registration.errors.*")`.
 */

export type RegisterInput = z.output<typeof registerSchema>

/** Why a workshop that is not open refuses a registration. */
const closedReason = {
  full: "registration.errors.full",
  closed: "registration.errors.deadline",
  started: "registration.errors.started",
  past: "registration.errors.started",
  cancelled: "registration.errors.cancelled",
  paused: "registration.errors.notOpen",
} as const

/**
 * Register a participant. The workshop must be published or confirmed, before
 * its registration deadline and start, with a free seat (registered + paid <
 * maximum; once confirmed, < the number fixed at the go decision, so nobody
 * takes part without the instructor being paid for them: `seatLimit`). The
 * member may register several people, but the same participant only once
 * (while active), and at most MAX_ACTIVE_PER_MEMBER.
 *
 * The amount is the workshop's price; the registration is "pending"
 * (registered, holds a seat, not paid yet), or "confirmed" right away for a
 * free workshop (nothing to pay). A paid workshop keeps how they will pay
 * (`paymentChoice`, one of the ways on). A workshop on several days needs
 * one of its days (`day`): not started, with a place left (`daySeatsLeft`).
 * The accepted terms (template, SHA-256 of
 * the exact text shown, time) and the photo / video choices are stored.
 */
export async function registerForWorkshop(
  memberId: string,
  input: RegisterInput,
  now: Date = new Date(),
): Promise<{ id: string; status: "pending" | "confirmed" }> {
  return db.transaction(async (tx) => {
    const [course] = await tx
      .select({
        id: courses.id,
        status: courses.status,
        cancelledAt: courses.cancelledAt,
        startsAt: courses.startsAt,
        endsAt: courses.endsAt,
        registrationDeadline: courses.registrationDeadline,
        days: courses.days,
        maxCapacity: courses.maxCapacity,
        finalParticipants: courses.finalParticipants,
        price: courses.price,
        termsTemplateId: courses.termsTemplateId,
        paymentUrl: courses.paymentUrl,
        publishedAt: courses.publishedAt,
      })
      .from(courses)
      .where(eq(courses.id, input.courseId))
      .for("no key update")
    if (!course || !course.publishedAt) throw new UserError("registration.errors.notFound")

    // The seat count is read under the lock: whoever comes second sees the first one's seat.
    const seats = daySeatsLeft(course, await seatsTakenByDay(course.id, tx))
    // Only the days still taking registrations (not started, before their own deadline).
    const open = bookableSeats(course, seats.days, now)
    const window = registrationWindow({ ...course, seatsLeft: open.reduce((a, b) => a + b, 0) }, now)
    if (window !== "open") throw new UserError(closedReason[window])
    // Several days: the day chosen must be one of them, not started, with a place left.
    const several = workshopDays(course).length > 1
    const day = several ? input.day : undefined
    if (several) {
      if (day === undefined || day >= seats.days.length) throw new UserError("registration.register.errors.day", { field: "day" })
      if (workshopDays(course)[day].startsAt <= now) throw new UserError("registration.errors.dayStarted", { field: "day" })
      if (dayDeadlines(course)[day] <= now) throw new UserError("registration.errors.deadline", { field: "day" })
      if (seats.days[day] <= 0) throw new UserError("registration.errors.dayFull", { field: "day" })
    }

    const mine = await tx
      .select({ participantName: registrations.participantName })
      .from(registrations)
      .where(
        and(
          eq(registrations.courseId, course.id),
          eq(registrations.memberId, memberId),
          inArray(registrations.status, [...activeStatuses]),
        ),
      )
    if (mine.some((r) => sameParticipant(r.participantName, input.participantName))) {
      throw new UserError("registration.errors.duplicate", {
        field: "participantName",
        values: { name: input.participantName },
      })
    }
    if (mine.length >= MAX_ACTIVE_PER_MEMBER) {
      throw new UserError("registration.errors.tooMany", { values: { max: MAX_ACTIVE_PER_MEMBER } })
    }

    const terms = await workshopTerms(course.termsTemplateId, input.locale, tx)
    if (!terms) throw new UserError("registration.errors.notOpen")
    if (terms.sha256 !== input.termsSha256) throw new UserError("registration.errors.termsChanged")

    // How they will pay: one of the ways on (the only one needs no choice); none for a free workshop.
    const ways = course.price > 0 ? paymentWayNames(await getSetting("payment"), course.paymentUrl) : []
    const paymentChoice = ways.length === 1 ? ways[0] : ways.find((w) => w === input.paymentChoice)
    if (ways.length > 1 && !paymentChoice) throw new UserError("registration.register.errors.paymentChoice", { field: "paymentChoice" })

    const status = course.price > 0 ? "pending" : "confirmed"
    const [row] = await tx
      .insert(registrations)
      .values({
        courseId: course.id,
        memberId,
        participantName: input.participantName,
        status,
        amount: course.price,
        termsTemplateId: terms.templateId,
        termsSha256: terms.sha256,
        termsAcceptedAt: now,
        photoConsent: input.photoConsent,
        videoConsent: input.videoConsent,
        paymentChoice: paymentChoice ?? null,
        day: day ?? null,
      })
      .returning({ id: registrations.id })
    // The bell in the panel: someone registered.
    await tx.insert(adminNotifications).values({ kind: "registration", registrationId: row.id })
    return { id: row.id, status }
  })
}

export type Cancelled = CancelPreview & { id: string; courseId: string }

/**
 * The member cancels one of their own active registrations, until the
 * workshop (several days: the day chosen) starts. Unpaid (or free): simply cancelled, refund 0. Paid: the
 * refund of the terms (100 / 50 / 0 % by the time left, `refund-policy.ts`)
 * is stored as `refund_amount`, to be paid back by hand by an admin.
 * Someone else's registration is "not found", never a different message.
 */
export async function cancelMyRegistration(memberId: string, id: string, now: Date = new Date()): Promise<Cancelled> {
  return db.transaction(async (tx) => {
    const mine = and(eq(registrations.id, id), eq(registrations.memberId, memberId))
    const [ref] = await tx.select({ courseId: registrations.courseId, day: registrations.day }).from(registrations).where(mine)
    if (!ref) throw new UserError("registration.errors.notFound")

    // Workshop first, then the registration: the lock order of payments (features/money/ledger).
    const [row] = await tx
      .select({ status: courses.status, startsAt: courses.startsAt, endsAt: courses.endsAt, days: courses.days, closedAt: courses.closedAt })
      .from(courses)
      .where(eq(courses.id, ref.courseId))
      .for("no key update")
    // Several days: the time left is counted to the day chosen.
    const course = row && forDay(row, ref.day)
    const [reg] = await tx
      .select({ status: registrations.status, amount: registrations.amount })
      .from(registrations)
      .where(mine)
      .for("update")
    if (!course || !reg) throw new UserError("registration.errors.notFound")
    if (reg.status === "cancelled") throw new UserError("registration.errors.alreadyCancelled")
    if (course.status === "cancelled" || course.status === "closed" || course.closedAt) {
      throw new UserError("registration.errors.cannotCancel")
    }
    if (now >= course.startsAt) throw new UserError("registration.errors.startedCancel")

    const preview = cancelPreview(reg, course.startsAt, now)
    await tx
      .update(registrations)
      .set({ status: "cancelled", cancelledAt: now, refundAmount: preview.refund })
      .where(mine)
    return { id, courseId: ref.courseId, ...preview }
  })
}
