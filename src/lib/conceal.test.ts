import { describe, expect, it } from "vitest"

import { conceal, reveal } from "./conceal"

describe("conceal", () => {
  it("leaves no address or number in the page, and gives it back in the browser", () => {
    for (const text of ["hello@limer.tr", "+90 535 418 85 05", "مینا@example.com", ""]) {
      const code = conceal(text)
      expect(code).toMatch(/^[a-z]*$/)
      expect(code).not.toContain("@")
      expect(code).not.toContain("limer")
      expect(code).not.toMatch(/\d{4,}/)
      expect(reveal(code)).toBe(text)
    }
  })

  it("reveals nothing from what is not a code", () => {
    expect(reveal("hello@limer.tr")).toBe("")
    expect(reveal("abc")).toBe("")
    expect(reveal("zz")).toBe("")
    expect(reveal("jzjz")).toBe("")
  })
})
