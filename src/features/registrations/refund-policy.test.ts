import { describe, expect, it } from "vitest"

import { refundAmount, refundPercent } from "./refund-policy"

const start = new Date("2026-11-10T10:00:00Z")
const before = (hours: number) => new Date(start.getTime() - hours * 3_600_000)

describe("refundPercent", () => {
  it.each([
    [100, 100],
    [72, 100],
    [71.99, 50],
    [24, 50],
    [23.99, 0],
    [0, 0],
    [-5, 0],
  ])("%s hours before the start → %s %%", (hours, percent) => expect(refundPercent(start, before(hours))).toBe(percent))
})

describe("refundAmount", () => {
  it("rounds down to a whole kuruş", () => expect(refundAmount(12_345, start, before(48))).toBe(6_172))
  it("is the full amount 3 days ahead", () => expect(refundAmount(50_000, start, before(80))).toBe(50_000))
})
