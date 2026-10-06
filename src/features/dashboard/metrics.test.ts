import { describe, expect, it } from "vitest"

import { addMonths, change, fillMonths, fillRate, lastMonths, partOfDay, workshopAlert } from "./metrics"

describe("dashboard metrics", () => {
  it("steps months across year ends", () => {
    expect(addMonths("2026-10-06", 0)).toBe("2026-10-01")
    expect(addMonths("2026-10-31", 3)).toBe("2027-01-01")
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01")
    expect(addMonths("2026-03-01", -27)).toBe("2023-12-01")
  })

  it("lists the last twelve months, oldest first, this month last", () => {
    const months = lastMonths("2026-10-06")
    expect(months).toHaveLength(12)
    expect(months[0]).toBe("2025-11-01")
    expect(months.at(-1)).toBe("2026-10-01")
    // Always reaches back to January, so the year so far is inside the window.
    expect(lastMonths("2026-12-31")[0]).toBe("2026-01-01")
  })

  it("fills missing months with zero and computes the net", () => {
    const filled = fillMonths(["2026-08-01", "2026-09-01", "2026-10-01"], [
      { month: "2026-09-01", revenue: 5000, expenses: 7000 },
      { month: "2026-10-01", revenue: 9000, expenses: 1000 },
      { month: "2020-01-01", revenue: 1, expenses: 1 }, // outside the window: ignored
    ])
    expect(filled).toEqual([
      { month: "2026-08-01", revenue: 0, expenses: 0, net: 0 },
      { month: "2026-09-01", revenue: 5000, expenses: 7000, net: -2000 },
      { month: "2026-10-01", revenue: 9000, expenses: 1000, net: 8000 },
    ])
  })

  it("compares only with a positive previous figure", () => {
    expect(change(150, 100)).toBe(0.5)
    expect(change(50, 100)).toBe(-0.5)
    expect(change(100, 0)).toBeNull()
    expect(change(100, -20)).toBeNull()
    expect(fillRate(6, 8)).toBe(0.75)
    expect(fillRate(0, 0)).toBeNull()
  })

  it("flags signatures and go / no-go decisions", () => {
    const now = new Date("2026-10-06T12:00:00Z")
    const at = (h: number) => new Date(now.getTime() + h * 3_600_000)
    const base = { status: "published", registered: 3, minCapacity: 5 }
    expect(workshopAlert({ ...base, status: "awaiting_signature", decisionAt: at(500) }, now)).toEqual({ kind: "awaitingSignature" })
    expect(workshopAlert({ ...base, decisionAt: at(-1) }, now)).toEqual({ kind: "decisionDue", missing: 2 })
    expect(workshopAlert({ ...base, registered: 9, decisionAt: now }, now)).toEqual({ kind: "decisionDue", missing: 0 })
    expect(workshopAlert({ ...base, decisionAt: at(48) }, now)).toEqual({ kind: "decisionSoon", at: at(48), missing: 2 })
    expect(workshopAlert({ ...base, decisionAt: at(100) }, now)).toBeNull()
    // Decided already: nothing to flag.
    expect(workshopAlert({ ...base, status: "confirmed", decisionAt: at(-10) }, now)).toBeNull()
  })

  it("greets by the time of day", () => {
    expect(partOfDay("04:59")).toBe("evening")
    expect(partOfDay("05:00")).toBe("morning")
    expect(partOfDay("12:00")).toBe("afternoon")
    expect(partOfDay("18:30")).toBe("evening")
  })
})
