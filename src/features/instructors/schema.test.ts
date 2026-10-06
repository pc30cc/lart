import { describe, expect, it } from "vitest"

import {
  languageName,
  maskIdNumber,
  normalizeIdNumber,
  normalizeMobile,
  normalizeWebsite,
  profileText,
} from "./schema"

describe("instructor field helpers", () => {
  it("normalises mobile numbers to +<country><number>", () => {
    expect(normalizeMobile("+90 (532) 123-45-67")).toBe("+905321234567")
    expect(normalizeMobile("0090 532 123 45 67")).toBe("+905321234567")
    expect(normalizeMobile("+۹۸ ۹۱۲ ۱۲۳ ۴۵۶۷")).toBe("+989121234567")
    expect(normalizeMobile("‎+90 532 123 4567")).toBe("+905321234567")
  })

  it("normalises ID numbers", () => {
    expect(normalizeIdNumber(" ۱۲۳ ۴۵۶-۷۸۹۰۱ ")).toBe("12345678901")
    expect(normalizeIdNumber("u 12.345 67")).toBe("U1234567")
  })

  it("turns an Instagram handle or a bare domain into an https link", () => {
    expect(normalizeWebsite("@elif.ceramics")).toBe("https://www.instagram.com/elif.ceramics")
    expect(normalizeWebsite("elif.art/works")).toBe("https://elif.art/works")
    expect(normalizeWebsite("http://elif.art")).toBe("http://elif.art")
    expect(normalizeWebsite("  ")).toBe("")
  })

  it("shows English on the Persian site when there is no Persian text", () => {
    const name = { tr: "Elif Hoca", en: "Elif" }
    expect(profileText(name, "fa")).toBe("Elif")
    expect(profileText({ ...name, fa: "الیف" }, "fa")).toBe("الیف")
    expect(profileText(name, "tr")).toBe("Elif Hoca")
    expect(profileText({ tr: "Elif Hoca" }, "en")).toBe("Elif Hoca")
    expect(profileText(null, "en")).toBe("")
  })

  it("masks all but the last three characters", () => {
    expect(maskIdNumber("12345678901")).toBe("••••••901")
  })

  it("names languages in the UI language", () => {
    expect(languageName("tr", "en")).toBe("Turkish")
    expect(languageName("fa", "tr")).toBe("Farsça")
    expect(languageName("tr", "tr")).toBe("Türkçe")
  })
})
