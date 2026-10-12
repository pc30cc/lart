import { describe, expect, it } from "vitest"

import { buildDays, extraDatesOf, formatWorkshopDates, workshopDays, workshopHours } from "./days"
import { workshopEditSchema } from "./schema"

// 17 October 2026, 12:00–15:00 in Istanbul (UTC+3).
const startsAt = new Date("2026-10-17T09:00:00Z")
const endsAt = new Date("2026-10-17T12:00:00Z")

describe("workshops on several days", () => {
  it("puts every other day at the first day's hours, and ends with the last one", () => {
    const built = buildDays(startsAt, endsAt, ["2026-10-20"])
    expect(built.days).toEqual([
      { startsAt: "2026-10-17T09:00:00.000Z", endsAt: "2026-10-17T12:00:00.000Z" },
      { startsAt: "2026-10-20T09:00:00.000Z", endsAt: "2026-10-20T12:00:00.000Z" },
    ])
    expect(built.endsAt.toISOString()).toBe("2026-10-20T12:00:00.000Z")
    expect(buildDays(startsAt, endsAt, [])).toEqual({ days: null, endsAt })
  })

  it("reads the days back for showing and for the edit form", () => {
    const course = { startsAt, ...buildDays(startsAt, endsAt, ["2026-10-20"]) }
    expect(workshopDays(course)).toHaveLength(2)
    expect(extraDatesOf(course)).toEqual(["2026-10-20"])
    expect(workshopHours(course, "en")).toBe("12:00–15:00")
    expect(formatWorkshopDates(course, "en", "long")).toMatch(/17 October 2026 · .*20 October 2026/)
    expect(formatWorkshopDates({ startsAt, endsAt, days: null }, "en", "long")).toBe("17 October 2026")
  })

  it("wants the other days after the first, each once", () => {
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
    const issues = (extraDates: string[]) =>
      (workshopEditSchema.safeParse({ ...base, extraDates }).error?.issues ?? []).filter((i) => i.path[0] === "extraDates")
    expect(issues(["2026-10-20"])).toHaveLength(0)
    expect(issues(["2026-10-17"])).toHaveLength(1)
    expect(issues(["2026-10-20", "2026-10-20"])).toHaveLength(1)
  })
})
