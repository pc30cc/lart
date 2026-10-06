import { describe, expect, it } from "vitest"

import { formatLira, parseLira, splitByShares } from "./money"

describe("parseLira", () => {
  it.each([
    ["1250", 125000],
    ["1250,5", 125050],
    ["1.250,50", 125050],
    ["1,250.50", 125050],
    ["₺ 99", 9900],
    ["0,01", 1],
  ])("%s → %d kuruş", (input, expected) => expect(parseLira(input)).toBe(expected))
  it.each(["", "abc", "1,2,3x", "-5"])("rejects %s", (input) => expect(parseLira(input)).toBeNull())
})

describe("splitByShares", () => {
  it("never loses a kuruş", () => {
    expect(splitByShares(100, [3334, 3333, 3333])).toEqual([34, 33, 33])
    expect(splitByShares(-100, [3334, 3333, 3333])).toEqual([-34, -33, -33])
    expect(splitByShares(1, [5000, 5000])).toEqual([1, 0])
  })
  it("requires shares to sum to 100 %", () => expect(() => splitByShares(10, [5000])).toThrow())
})

describe("formatLira", () => {
  it("formats Turkish lira", () => expect(formatLira(125050, "tr")).toContain("1.250,5"))
})
