import { describe, expect, it } from "vitest"

import { parseTime, parseWholeNumber } from "./digit-inputs"

describe("digit inputs", () => {
  it("read whole numbers in Persian, Arabic and Latin digits", () => {
    expect(parseWholeNumber("12")).toBe(12)
    expect(parseWholeNumber("۱۲")).toBe(12)
    expect(parseWholeNumber("١٢")).toBe(12)
    expect(parseWholeNumber(" ۸ ")).toBe(8)
    expect(parseWholeNumber("")).toBeNull()
    expect(parseWholeNumber("  ")).toBeNull()
    expect(Number.isNaN(parseWholeNumber("۱۲a"))).toBe(true)
    expect(Number.isNaN(parseWholeNumber("1.5"))).toBe(true)
    expect(Number.isNaN(parseWholeNumber("-3"))).toBe(true)
  })

  it("read times of day in any digits and common spellings", () => {
    expect(parseTime("10:30")).toBe("10:30")
    expect(parseTime("۱۰:۳۰")).toBe("10:30")
    expect(parseTime("10.30")).toBe("10:30")
    expect(parseTime("1030")).toBe("10:30")
    expect(parseTime("930")).toBe("09:30")
    expect(parseTime("9")).toBe("09:00")
    expect(parseTime("۱۸")).toBe("18:00")
    expect(parseTime("0:05")).toBe("00:05")
    expect(parseTime("24:00")).toBeNull()
    expect(parseTime("10:60")).toBeNull()
    expect(parseTime("10:")).toBeNull()
    expect(parseTime("")).toBeNull()
    expect(parseTime("ab")).toBeNull()
  })
})
