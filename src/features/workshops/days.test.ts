import { describe, expect, it } from "vitest"

import { buildDays, dayDateLabel, extraDaysOf, formatWorkshopDates, sameHours, workshopDays, workshopHours, type ExtraDay } from "./days"
import { workshopEditSchema } from "./schema"

// 17 October 2026, 12:00–15:00 in Istanbul (UTC+3).
const startsAt = new Date("2026-10-17T09:00:00Z")
const endsAt = new Date("2026-10-17T12:00:00Z")

const day2: ExtraDay = { date: "2026-10-20", start: "12:00", end: "15:00", minCapacity: 1, maxCapacity: 8 }

describe("workshops on several days", () => {
  it("keeps every other day with its own hours and participants, and ends with the last one", () => {
    const built = buildDays(startsAt, endsAt, [{ ...day2, start: "10:00", end: "13:30", maxCapacity: 6 }])
    expect(built.days).toEqual([
      { startsAt: "2026-10-17T09:00:00.000Z", endsAt: "2026-10-17T12:00:00.000Z" },
      { startsAt: "2026-10-20T07:00:00.000Z", endsAt: "2026-10-20T10:30:00.000Z", minCapacity: 1, maxCapacity: 6 },
    ])
    expect(built.endsAt.toISOString()).toBe("2026-10-20T10:30:00.000Z")
    expect(buildDays(startsAt, endsAt, [])).toEqual({ days: null, endsAt })
  })

  it("reads the days back for showing and for the edit form", () => {
    const course = { startsAt, minCapacity: 1, maxCapacity: 8, ...buildDays(startsAt, endsAt, [day2]) }
    expect(workshopDays(course)).toHaveLength(2)
    expect(extraDaysOf(course)).toEqual([day2])
    expect(sameHours(course)).toBe(true)
    expect(workshopHours(course, "en")).toBe("12:00–15:00")
    expect(formatWorkshopDates(course, "en", "long")).toMatch(/17 October 2026 · .*20 October 2026/)
    expect(formatWorkshopDates({ startsAt, endsAt, days: null }, "en", "long")).toBe("17 October 2026")

    const other = { startsAt, minCapacity: 1, maxCapacity: 8, ...buildDays(startsAt, endsAt, [{ ...day2, start: "10:00", end: "13:00" }]) }
    expect(sameHours(other)).toBe(false)
    expect(workshopHours(other, "en")).toBe("12:00–15:00 · 10:00–13:00")
  })

  it("reads an older day without participants as the workshop's", () => {
    const course = {
      startsAt,
      endsAt: new Date("2026-10-20T12:00:00Z"),
      minCapacity: 2,
      maxCapacity: 9,
      days: [
        { startsAt: "2026-10-17T09:00:00.000Z", endsAt: "2026-10-17T12:00:00.000Z" },
        { startsAt: "2026-10-20T09:00:00.000Z", endsAt: "2026-10-20T12:00:00.000Z" },
      ],
    }
    expect(extraDaysOf(course)).toEqual([{ date: "2026-10-20", start: "12:00", end: "15:00", minCapacity: 2, maxCapacity: 9 }])
  })

  it("wants the other days after the first, each once, ending after they start, with sensible participants", () => {
    const base = {
      title: { fa: "ش", tr: "M", en: "C" },
      slug: "mum",
      categoryId: "00000000-0000-4000-8000-000000000001",
      instructorId: "00000000-0000-4000-8000-000000000002",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      registrationDeadline: "2026-10-16T09:00:00Z",
      decisionAt: "2026-10-15T09:00:00Z",
      venue: { tr: "Moda" },
      ageGroup: "adults",
      ageMin: null,
      ageMax: null,
      minCapacity: 1,
      maxCapacity: 8,
      price: 450_000,
      termsTemplateId: null,
      intro: {},
      includes: {},
      bringNothing: true,
      bring: {},
      experienceRequired: false,
      experienceNote: {},
      notes: {},
      coverPath: null,
      samples: [],
      feeType: "fixed",
      feeAmount: 0,
      hasAdvance: false,
      advanceAmount: null,
    } as const
    const issues = (extraDays: ExtraDay[]) =>
      (workshopEditSchema.safeParse({ ...base, extraDays }).error?.issues ?? []).filter((i) => i.path[0] === "extraDays")
    expect(issues([day2])).toHaveLength(0)
    expect(issues([{ ...day2, date: "2026-10-17" }])).toHaveLength(1)
    expect(issues([day2, day2])).toHaveLength(1)
    expect(issues([{ ...day2, end: "11:00" }])).toHaveLength(1)
    expect(issues([{ ...day2, minCapacity: 9, maxCapacity: 4 }])).toHaveLength(1)
  })
})

describe("two sessions on the same day", () => {
  it("names the date once and gives both hours", () => {
    const c = {
      startsAt: new Date("2026-10-24T09:00:00Z"),
      endsAt: new Date("2026-10-24T16:00:00Z"),
      days: [
        { startsAt: "2026-10-24T09:00:00.000Z", endsAt: "2026-10-24T12:00:00.000Z" },
        { startsAt: "2026-10-24T13:00:00.000Z", endsAt: "2026-10-24T16:00:00.000Z" },
      ],
    }
    expect(formatWorkshopDates(c, "en", "long")).not.toContain(" · ")
    expect(workshopHours(c, "en")).toContain(" · ")
    // Each session's own label carries its hours, so the two can be told apart.
    expect(dayDateLabel(c, 0, "en")).toMatch(/12:00/)
    expect(dayDateLabel(c, 1, "en")).toMatch(/16:00/)
    expect(dayDateLabel(c, 1, "en")).not.toBe(dayDateLabel(c, 0, "en"))
  })

  it("leaves the hours out when every day has its own date", () => {
    const c = {
      startsAt: new Date("2026-10-20T09:00:00Z"),
      endsAt: new Date("2026-10-22T12:00:00Z"),
      days: [
        { startsAt: "2026-10-20T09:00:00.000Z", endsAt: "2026-10-20T12:00:00.000Z" },
        { startsAt: "2026-10-22T09:00:00.000Z", endsAt: "2026-10-22T12:00:00.000Z" },
      ],
    }
    expect(dayDateLabel(c, 1, "en")).not.toMatch(/12:00/)
  })
})
