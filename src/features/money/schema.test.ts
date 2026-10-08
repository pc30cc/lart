import { describe, expect, it } from "vitest"

import { parseRange, parseReportParams } from "./schema"

// 8 Oct 2026, 10:00 in Istanbul: 16 Mehr 1405.
const NOW = new Date("2026-10-08T07:00:00Z")

describe("report ranges", () => {
  it("default to this year of the viewer's calendar", () => {
    expect(parseRange({}, NOW)).toEqual({ from: "2026-01-01", to: "2026-12-31" })
    // 1405: Nowruz (21 Mar 2026) to the last day of Esfand (20 Mar 2027).
    expect(parseRange({}, NOW, "persian")).toEqual({ from: "2026-03-21", to: "2027-03-20" })
    // Before Nowruz, it is still 1404.
    expect(parseRange({}, new Date("2026-03-20T07:00:00Z"), "persian")).toEqual({ from: "2025-03-21", to: "2026-03-20" })
  })

  it("keep a range from the URL, in either order, whatever the calendar", () => {
    expect(parseRange({ from: "2026-05-01", to: "2026-02-01" }, NOW, "persian")).toEqual({ from: "2026-02-01", to: "2026-05-01" })
    expect(parseReportParams({ report: "pnl", group: "quarter" }, NOW, "persian")).toMatchObject({
      report: "pnl",
      group: "quarter",
      from: "2026-03-21",
      to: "2027-03-20",
    })
  })
})
