import { describe, expect, it } from "vitest"

import { addPeriods, calendarFields, dayBefore, periodEnd, periodStart, periodStarts } from "./calendar"

describe("calendar periods", () => {
  it("knows Gregorian months, quarters and years", () => {
    expect(periodStart("2026-10-08", "month", "gregory")).toBe("2026-10-01")
    expect(periodStart("2026-10-08", "quarter", "gregory")).toBe("2026-10-01")
    expect(periodStart("2026-08-08", "quarter", "gregory")).toBe("2026-07-01")
    expect(periodStart("2026-10-08", "year", "gregory")).toBe("2026-01-01")
    expect(periodEnd("2028-02-10", "month", "gregory")).toBe("2028-02-29")
    expect(addPeriods("2026-01-31", 1, "month", "gregory")).toBe("2026-02-28")
    expect(calendarFields("2026-10-08", "gregory")).toEqual({ year: 2026, month: 10, quarter: 4 })
  })

  it("knows Solar Hijri months, seasons and years", () => {
    // 16 Mehr 1405: Mehr runs 23 Sep – 22 Oct 2026; autumn (the third season) starts 1 Mehr; 1405 starts at Nowruz, 21 Mar 2026.
    expect(periodStart("2026-10-08", "month", "persian")).toBe("2026-09-23")
    expect(periodEnd("2026-10-08", "month", "persian")).toBe("2026-10-22")
    expect(periodStart("2026-10-08", "quarter", "persian")).toBe("2026-09-23")
    expect(periodStart("2026-10-08", "year", "persian")).toBe("2026-03-21")
    expect(periodEnd("2026-10-08", "year", "persian")).toBe("2027-03-20")
    expect(calendarFields("2026-10-08", "persian")).toEqual({ year: 1405, month: 7, quarter: 3 })
    // Esfand has 29 days in 1404 and 30 in 1403 (a leap year).
    expect(periodEnd("2026-03-01", "month", "persian")).toBe("2026-03-20")
    expect(periodEnd("2025-03-01", "month", "persian")).toBe("2025-03-20")
    expect(periodStart("2025-03-20", "year", "persian")).toBe("2024-03-20")
  })

  it("lists every period in a range, in both calendars", () => {
    expect(periodStarts("2026-09-15", "2026-11-02", "month", "gregory")).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"])
    expect(periodStarts("2026-02-10", "2026-12-31", "quarter", "gregory")).toEqual(["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"])
    expect(periodStarts("2025-06-01", "2027-01-01", "year", "gregory")).toEqual(["2025-01-01", "2026-01-01", "2027-01-01"])
    expect(periodStarts("2026-11-01", "2027-02-28", "month", "gregory")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"])
    expect(periodStarts("2026-09-15", "2026-11-02", "month", "persian")).toEqual(["2026-08-23", "2026-09-23", "2026-10-23"])
    expect(periodStarts("2025-01-01", "2026-12-31", "year", "persian")).toEqual(["2024-03-20", "2025-03-21", "2026-03-21"])
  })

  it("steps a day back across months and years", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28")
    expect(dayBefore("2026-01-01")).toBe("2025-12-31")
  })
})
