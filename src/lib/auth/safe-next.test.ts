import { describe, expect, it } from "vitest"

import { safeNext } from "./safe-next"

const FALLBACK = "/tr/workshops"

describe("safeNext for members", () => {
  it.each([
    ["/tr/workshops/candles", "/tr/workshops/candles"],
    ["/fa/account", "/fa/account"],
    ["/en/workshops?category=ceramics#top", "/en/workshops?category=ceramics"],
    ["/tr", "/tr"],
    ["/tr?x=1", "/tr?x=1"],
    // Normalised like a browser would, then checked again.
    ["/tr/workshops/../account", "/tr/account"],
  ])("keeps the site page %s", (next, expected) => {
    expect(safeNext(next, "member", FALLBACK)).toBe(expected)
  })

  it.each([
    ["another site", "https://evil.example/tr"],
    ["a protocol-relative link", "//evil.example/tr"],
    ["a backslash trick", "/\\evil.example"],
    ["a tab trick", "/\t/evil.example"],
    ["a scheme", "javascript:alert(1)"],
    ["no language", "/workshops"],
    ["an unknown language", "/de/workshops"],
    ["the admin panel", "/tr/admin/money"],
    ["the admin panel with a query", "/tr/admin?x=1"],
    ["the instructor panel", "/tr/instructor"],
    ["an encoded escape to the admin panel", "/tr/%2e%2e/admin"],
    ["the login page (loop)", "/tr/account/login"],
    ["the sign-up page", "/fa/account/signup?next=/fa"],
    ["the verify link", "/en/account/verify?token=x"],
    ["an API", "/api/admin/uploads"],
    ["nothing", ""],
    ["a non-string", ["/tr"]],
    ["something too long", `/tr/${"a".repeat(400)}`],
  ])("refuses %s", (_name, next) => {
    expect(safeNext(next, "member", FALLBACK)).toBe(FALLBACK)
  })
})

describe("safeNext for instructors", () => {
  it("keeps pages of the instructor panel only", () => {
    expect(safeNext("/fa/instructor/contracts?c=1", "instructor", "/fa/instructor")).toBe("/fa/instructor/contracts?c=1")
    expect(safeNext("/fa/instructor", "instructor", "x")).toBe("/fa/instructor")
    for (const next of ["/fa/workshops", "/fa/admin", "/fa/instructor/login", "/fa/instructor/accept-invite?token=t", "/fa/instructors"]) {
      expect(safeNext(next, "instructor", "/fa/instructor"), next).toBe("/fa/instructor")
    }
  })
})
