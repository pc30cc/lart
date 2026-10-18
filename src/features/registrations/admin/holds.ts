import "server-only"
import { and, asc, eq, gt } from "drizzle-orm"

import { db, type Tx } from "@/db"
import { admins, courses, seatHolds } from "@/db/schema"
import { booksClosed } from "@/features/money/ledger"
import { workshopDays } from "@/features/workshops/days"
import { UserError } from "@/lib/errors"
import { seatsTakenByDay } from "../public"
import { daySeatsLeft } from "../schema"

/**
 * Places held for guests (Registrations → "Hold places"): they count as taken
 * wherever places are counted (`seatsTakenByDay`), so the site shows them
 * taken like any registration, but they are no registration: no money, no
 * email, not in the finances. Under the workshop's lock like a registration:
 * a published or confirmed workshop with open books, a day not begun, and no
 * more than the places left. Deleting a hold frees its places.
 */
export async function holdSeats(
  tx: Tx,
  input: { courseId: string; day?: number; count: number; note: string; invited?: boolean },
  adminId: string,
  now = new Date(),
) {
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
    })
    .from(courses)
    .where(eq(courses.id, input.courseId))
    .for("no key update")
  if (!course) throw new UserError("registration.errors.notFound")
  if (course.status === "cancelled" || course.cancelledAt) throw new UserError("registration.errors.cancelled")
  if (booksClosed(course) || (course.status !== "published" && course.status !== "confirmed")) {
    throw new UserError("workshops.registrations.holds.errors.notOpen")
  }
  const days = workshopDays(course)
  const several = days.length > 1
  const day = several ? input.day : undefined
  if (several && (day === undefined || day >= days.length)) throw new UserError("registration.register.errors.day", { field: "day" })
  if (days[day ?? 0].startsAt <= now) throw new UserError(several ? "registration.errors.dayStarted" : "registration.errors.started", { field: "day" })
  const left = daySeatsLeft(course, await seatsTakenByDay(course.id, tx)).days[day ?? 0]
  if (input.count > left) throw new UserError("workshops.registrations.holds.errors.tooMany", { field: "count", values: { left } })
  const [row] = await tx
    .insert(seatHolds)
    .values({ courseId: course.id, day: several ? (day ?? null) : null, count: input.count, note: input.note, invited: input.invited ?? false, createdBy: adminId })
    .returning({ id: seatHolds.id })
  return { id: row.id, day: day ?? null }
}

/**
 * One place more or less in a hold (−1 frees one; at 0 the hold is gone; +1
 * takes one more of the day's free places). Under the workshop's lock.
 * Returns the hold's workshop, day and new count (0: deleted).
 */
export async function changeHold(tx: Tx, id: string, delta: 1 | -1) {
  const [ref] = await tx.select({ courseId: seatHolds.courseId }).from(seatHolds).where(eq(seatHolds.id, id))
  if (!ref) throw new UserError("workshops.registrations.holds.errors.gone")
  const [course] = await tx
    .select({
      id: courses.id,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
      days: courses.days,
      maxCapacity: courses.maxCapacity,
      finalParticipants: courses.finalParticipants,
    })
    .from(courses)
    .where(eq(courses.id, ref.courseId))
    .for("no key update")
  const [hold] = await tx.select().from(seatHolds).where(eq(seatHolds.id, id)).for("update")
  if (!hold || !course) throw new UserError("workshops.registrations.holds.errors.gone")
  if (delta > 0) {
    const left = daySeatsLeft(course, await seatsTakenByDay(course.id, tx)).days[hold.day ?? 0] ?? 0
    if (left < 1) throw new UserError("workshops.registrations.holds.errors.tooMany", { values: { left: 0 } })
    if (hold.count >= 100) throw new UserError("workshops.registrations.holds.errors.tooMany", { values: { left: 0 } })
  }
  const count = hold.count + delta
  if (count <= 0) await tx.delete(seatHolds).where(eq(seatHolds.id, id))
  else await tx.update(seatHolds).set({ count }).where(eq(seatHolds.id, id))
  return { courseId: hold.courseId, day: hold.day, count, note: hold.note }
}

/** The holds of the workshops not over yet, every workshop's together (the Registrations page). */
export async function listOpenHolds(now = new Date()) {
  return db
    .select({
      id: seatHolds.id,
      courseId: seatHolds.courseId,
      title: courses.title,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
      days: courses.days,
      day: seatHolds.day,
      count: seatHolds.count,
      note: seatHolds.note,
      invited: seatHolds.invited,
      createdAt: seatHolds.createdAt,
      by: admins.name,
    })
    .from(seatHolds)
    .innerJoin(courses, eq(courses.id, seatHolds.courseId))
    .leftJoin(admins, eq(admins.id, seatHolds.createdBy))
    .where(gt(courses.endsAt, now))
    .orderBy(asc(courses.startsAt), asc(seatHolds.createdAt))
}

/** Free the places of a hold. Returns what it was, for the log. */
export async function releaseHold(tx: Tx, id: string) {
  const [row] = await tx.delete(seatHolds).where(eq(seatHolds.id, id)).returning()
  if (!row) throw new UserError("workshops.registrations.holds.errors.gone")
  return row
}

/** A workshop's holds, oldest first, with who made each. */
export async function listHolds(courseId: string) {
  return db
    .select({
      id: seatHolds.id,
      day: seatHolds.day,
      count: seatHolds.count,
      note: seatHolds.note,
      invited: seatHolds.invited,
      createdAt: seatHolds.createdAt,
      by: admins.name,
    })
    .from(seatHolds)
    .leftJoin(admins, eq(admins.id, seatHolds.createdBy))
    .where(and(eq(seatHolds.courseId, courseId)))
    .orderBy(asc(seatHolds.createdAt))
}

export type SeatHold = Awaited<ReturnType<typeof listHolds>>[number]
