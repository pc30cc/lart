import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import type { z } from "zod"

import { db } from "@/db"
import { courses, registrations } from "@/db/schema"
import { UserError } from "@/lib/errors"
import { seatsTaken, workshopTerms } from "./public"
import {
  activeStatuses,
  cancelPreview,
  MAX_ACTIVE_PER_MEMBER,
  registrationWindow,
  sameParticipant,
  seatLimit,
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
 * free workshop (nothing to pay). The accepted terms (template, SHA-256 of
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
        maxCapacity: courses.maxCapacity,
        finalParticipants: courses.finalParticipants,
        price: courses.price,
        termsTemplateId: courses.termsTemplateId,
        publishedAt: courses.publishedAt,
      })
      .from(courses)
      .where(eq(courses.id, input.courseId))
      .for("no key update")
    if (!course || !course.publishedAt) throw new UserError("registration.errors.notFound")

    // The seat count is read under the lock: whoever comes second sees the first one's seat.
    const left = seatLimit(course) - (await seatsTaken(course.id, tx))
    const window = registrationWindow({ ...course, seatsLeft: left }, now)
    if (window !== "open") throw new UserError(closedReason[window])

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
      })
      .returning({ id: registrations.id })
    return { id: row.id, status }
  })
}

export type Cancelled = CancelPreview & { id: string; courseId: string }

/**
 * The member cancels one of their own active registrations, until the
 * workshop starts. Unpaid (or free): simply cancelled, refund 0. Paid: the
 * refund of the terms (100 / 50 / 0 % by the time left, `refund-policy.ts`)
 * is stored as `refund_amount`, to be paid back by hand by an admin.
 * Someone else's registration is "not found", never a different message.
 */
export async function cancelMyRegistration(memberId: string, id: string, now: Date = new Date()): Promise<Cancelled> {
  return db.transaction(async (tx) => {
    const mine = and(eq(registrations.id, id), eq(registrations.memberId, memberId))
    const [ref] = await tx.select({ courseId: registrations.courseId }).from(registrations).where(mine)
    if (!ref) throw new UserError("registration.errors.notFound")

    // Workshop first, then the registration: the lock order of payments (features/money/ledger).
    const [course] = await tx
      .select({ status: courses.status, startsAt: courses.startsAt, closedAt: courses.closedAt })
      .from(courses)
      .where(eq(courses.id, ref.courseId))
      .for("no key update")
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
