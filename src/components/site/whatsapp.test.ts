import { describe, expect, it } from "vitest"

import { whatsappHref } from "./whatsapp"

describe("whatsappHref", () => {
  it("writes the number in international digits for wa.me", () => {
    expect(whatsappHref("+90 532 123 45 67")).toBe("https://wa.me/905321234567")
    expect(whatsappHref("0532 123 45 67")).toBe("https://wa.me/905321234567")
    expect(whatsappHref("0090 (532) 123-4567")).toBe("https://wa.me/905321234567")
    expect(whatsappHref("+98 912 000 1122")).toBe("https://wa.me/989120001122")
  })

  it("gives nothing for something that is not a number", () => {
    expect(whatsappHref("")).toBe("")
    expect(whatsappHref("12-34")).toBe("")
  })
})
