import "server-only"
import { and, asc, eq, gt, ilike, inArray, isNull, or } from "drizzle-orm"

import { likePattern } from "@/components/admin/data-table/params"
import { db, type Tx } from "@/db"
import { courses, members, registrations } from "@/db/schema"
import { booksClosed } from "@/features/money/ledger"
import { workshopDays } from "@/features/workshops/days"
import { UserError } from "@/lib/errors"
import { localized } from "@/lib/format"
import { seatsTakenByDay, workshopTerms } from "../public"
import { activeStatuses, daySeatsLeft, sameParticipant } from "../schema"
import { momentOf, recordPayment } from "./payments"
import type { addRegistrationSchema } from "./schema"
import type { z } from "zod"

type Input = z.output<typeof addRegistrationSchema>

/**
 * A super admin registers a member for a workshop ("Add registration"). Like
 * the member's own registration (`registerForWorkshop`), under the workshop's
 * lock: a published or confirmed workshop whose books are open, a day that has
 * not begun with a place left (several days: the day chosen), the same
 * participant only once. Unlike it, the registration deadline does not apply
 * (people also register at the desk or by phone). The member's language's
 * terms are recorded as accepted at this moment, on the admin's word. Paid:
 * the payment is recorded too (`recordPayment`: confirmed, posted to the
 * wallet). Returns the registration and whether it is paid.
 */
export async function registerByAdmin(tx: Tx, input: Input, adminId: string, now: Date = new Date()) {
  const [course] = await tx
    .select({
      id: courses.id,
      status: courses.status,
      cancelledAt: courses.cancelledAt,
      closedAt: courses.closedAt,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
      days: courses.days,
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
  if (course.status === "cancelled" || course.cancelledAt) throw new UserError("registration.errors.cancelled")
  if (booksClosed(course) || (course.status !== "published" && course.status !== "confirmed")) {
    throw new UserError("registration.errors.notOpen")
  }

  const days = workshopDays(course)
  const several = days.length > 1
  const day = several ? input.day : undefined
  if (several && (day === undefined || day >= days.length)) throw new UserError("registration.register.errors.day", { field: "day" })
  if (days[day ?? 0].startsAt <= now) throw new UserError(several ? "registration.errors.dayStarted" : "registration.errors.started", { field: "day" })
  const seats = daySeatsLeft(course, await seatsTakenByDay(course.id, tx))
  if (seats.days[day ?? 0] <= 0) throw new UserError(several ? "registration.errors.dayFull" : "registration.errors.full", { field: "day" })

  const [member] = await tx.select({ locale: members.locale }).from(members).where(eq(members.id, input.memberId))
  if (!member) throw new UserError("students.errors.notFound", { field: "memberId" })
  const mine = await tx
    .select({ participantName: registrations.participantName })
    .from(registrations)
    .where(and(eq(registrations.courseId, course.id), eq(registrations.memberId, input.memberId), inArray(registrations.status, [...activeStatuses])))
  if (mine.some((r) => sameParticipant(r.participantName, input.participantName))) {
    throw new UserError("registration.errors.duplicate", { field: "participantName", values: { name: input.participantName } })
  }

  const terms = await workshopTerms(course.termsTemplateId, member.locale, tx)
  if (!terms) throw new UserError("registration.errors.notOpen")
  const paid = input.paid && course.price > 0
  const [row] = await tx
    .insert(registrations)
    .values({
      courseId: course.id,
      memberId: input.memberId,
      participantName: input.participantName,
      status: course.price > 0 ? "pending" : "confirmed",
      amount: course.price,
      termsTemplateId: terms.templateId,
      termsSha256: terms.sha256,
      termsAcceptedAt: now,
      paymentChoice: course.price > 0 ? (input.method ?? null) : null,
      day: day ?? null,
    })
    .returning({ id: registrations.id })
  if (paid) {
    await recordPayment(tx, {
      registrationId: row.id,
      method: input.method!,
      amount: course.price,
      paidAt: input.paidOn ? momentOf(input.paidOn, now) : now,
      createdBy: adminId,
    }, now)
  }
  return { id: row.id, courseId: course.id, paid, free: course.price === 0 }
}

/** Members found by name, email or phone for "Add registration" (at most 12, by name). */
export async function searchMembers(q: string) {
  const pattern = likePattern(q)
  return db
    .select({ id: members.id, name: members.name, email: members.email, phone: members.phone })
    .from(members)
    .where(q ? or(ilike(members.name, pattern), ilike(members.email, pattern), ilike(members.phone, pattern)) : undefined)
    .orderBy(asc(members.name))
    .limit(12)
}

/**
 * The workshops "Add registration" offers: published or confirmed, books
 * open, not over; each with its days (start and end, places left, begun or
 * not) in the admin's language.
 */
export async function registrableWorkshops(locale: string, now: Date = new Date()) {
  const rows = await db
    .select({
      id: courses.id,
      title: courses.title,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
      days: courses.days,
      maxCapacity: courses.maxCapacity,
      finalParticipants: courses.finalParticipants,
      price: courses.price,
    })
    .from(courses)
    .where(and(inArray(courses.status, ["published", "confirmed"]), isNull(courses.cancelledAt), isNull(courses.closedAt), gt(courses.endsAt, now)))
    .orderBy(asc(courses.startsAt))
  return Promise.all(
    rows.map(async (c) => {
      const seats = daySeatsLeft(c, await seatsTakenByDay(c.id))
      return {
        id: c.id,
        title: localized(c.title, locale),
        price: c.price,
        days: workshopDays(c).map((d, i) => ({
          startsAt: d.startsAt.toISOString(),
          endsAt: d.endsAt.toISOString(),
          left: seats.days[i] ?? 0,
          begun: d.startsAt <= now,
        })),
      }
    }),
  )
}

export type RegistrableWorkshop = Awaited<ReturnType<typeof registrableWorkshops>>[number]
