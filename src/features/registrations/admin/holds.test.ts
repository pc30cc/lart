import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "@/db"
import { courses, ledgerTransactions } from "@/db/schema"
import { addRegistration, makeAdmin, makeCourse, makeWorld } from "@/features/money/testing"
import { UserError } from "@/lib/errors"
import { getPublicWorkshop, seatsTakenByDay } from "../public"
import { holdSeats, listHolds, releaseHold } from "./holds"

const DAY = 86_400_000
const userError = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (err) {
    if (err instanceof UserError) return err.key
    throw err
  }
  throw new Error("expected a UserError")
}

describe("places held for guests", () => {
  it("count as taken (the site shows them full like registrations), cost nothing, and free their places when deleted", async () => {
    const world = await makeWorld()
    const admin = await makeAdmin("Holder")
    const course = await makeCourse(world, admin.id, { status: "published", endsAt: new Date(Date.now() + 10 * DAY) })
    // 20 places: 2 registered, then 18 held → full.
    await addRegistration(world, course, { status: "pending" })
    await addRegistration(world, course, { status: "confirmed" })
    await db.update(courses).set({ publishedAt: new Date(), registrationDeadline: new Date(Date.now() + 5 * DAY) }).where(eq(courses.id, course))

    expect(await userError(db.transaction((tx) => holdSeats(tx, { courseId: course, count: 19, note: "" }, admin.id)))).toBe(
      "workshops.registrations.holds.errors.tooMany",
    )
    const held = await db.transaction((tx) => holdSeats(tx, { courseId: course, count: 18, note: "Family" }, admin.id))
    expect(await seatsTakenByDay(course)).toEqual([20])
    expect(await listHolds(course)).toEqual([expect.objectContaining({ count: 18, note: "Family", by: "Holder" })])

    const [{ slug }] = await db.select({ slug: courses.slug }).from(courses).where(eq(courses.id, course))
    const page = (await getPublicWorkshop(slug, "en"))!
    expect(page.window).toBe("full")
    expect(page.seatsLeft).toBe(0)

    // No money: nothing in the ledger for the workshop.
    expect(await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.courseId, course))).toEqual([])

    await db.transaction((tx) => releaseHold(tx, held.id))
    expect(await seatsTakenByDay(course)).toEqual([2])
    expect(await userError(db.transaction((tx) => releaseHold(tx, held.id)))).toBe("workshops.registrations.holds.errors.gone")
  })

  it("are refused once the workshop has started or is cancelled", async () => {
    const world = await makeWorld()
    const admin = await makeAdmin("Holder 2")
    const past = await makeCourse(world, admin.id, { status: "published" })
    expect(await userError(db.transaction((tx) => holdSeats(tx, { courseId: past, count: 1, note: "" }, admin.id)))).toBe("registration.errors.started")
    const cancelled = await makeCourse(world, admin.id, { status: "cancelled", endsAt: new Date(Date.now() + 10 * DAY) })
    expect(await userError(db.transaction((tx) => holdSeats(tx, { courseId: cancelled, count: 1, note: "" }, admin.id)))).toBe("registration.errors.cancelled")
  })
})
