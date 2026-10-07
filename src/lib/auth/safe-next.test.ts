import { describe, expect, it } from "vitest"

import { safeNext } from "./safe-next"

const FALLBACK = "/workshops"
/** The main language of these tests (pure: passed in, as the server passes `await mainLocale()`). */
const MAIN = "tr"

describe("safeNext for members", () => {
  it.each([
    ["/workshops", "/workshops"],
    ["/workshops/candles", "/workshops/candles"],
    ["/workshops/candles/register?x=1", "/workshops/candles/register?x=1"],
    ["/fa/account", "/fa/account"],
    ["/account/registrations/r1", "/account/registrations/r1"],
    ["/en/workshops?category=ceramics#top", "/en/workshops?category=ceramics"],
    ["/", "/"],
    ["/fa", "/fa"],
    // Normalised like a browser would, then checked again.
    ["/fa/workshops/../account", "/fa/account"],
  ])("keeps the site page %s", (next, expected) => {
    expect(safeNext(next, "member", FALLBACK, MAIN)).toBe(expected)
  })

  it.each([
    // The main language's prefix (an address from before the URL rules, or a page opened before the main language changed).
    ["/tr/workshops/candles", "/workshops/candles"],
    ["/tr?x=1", "/?x=1"],
    ["/tr/account", "/account"],
    // A prefix in capitals.
    ["/FA/workshops", "/fa/workshops"],
    ["/TR/workshops?x=1", "/workshops?x=1"],
    ["/En", "/en"],
    // A trailing or doubled slash.
    ["/workshops/", "/workshops"],
    ["/fa/", "/fa"],
    ["/fa//workshops//candles/", "/fa/workshops/candles"],
  ])("gives %s at its address today, %s, so the browser needs no second redirect (R1)", (next, expected) => {
    expect(safeNext(next, "member", FALLBACK, MAIN)).toBe(expected)
  })

  it("writes the address for the main language it is given", () => {
    expect(safeNext("/tr/workshops?x=1", "member", FALLBACK, "fa")).toBe("/tr/workshops?x=1")
    expect(safeNext("/fa/workshops?x=1", "member", FALLBACK, "fa")).toBe("/workshops?x=1")
    expect(safeNext("/workshops", "member", FALLBACK, "en")).toBe("/workshops")
    expect(safeNext("/en", "member", FALLBACK, "en")).toBe("/")
  })

  it.each([
    ["another site", "https://evil.example/tr"],
    ["a protocol-relative link", "//evil.example/tr"],
    ["a backslash trick", "/\\evil.example"],
    ["a tab trick", "/\t/evil.example"],
    ["a scheme", "javascript:alert(1)"],
    ["an unknown page", "/nowhere"],
    ["an unknown language", "/de/workshops"],
    ["the admin panel", "/admin/money"],
    ["the admin panel in a language", "/fa/admin/money"],
    ["the admin panel with a query", "/admin?x=1"],
    ["the instructor panel", "/instructor"],
    ["an instructor sign-in page", "/instructor/invite?token=t"],
    ["an old instructor invitation address", "/instructor/accept-invite?token=t"],
    ["an encoded escape to the admin panel", "/fa/%2e%2e/admin"],
    ["the login page (loop)", "/account/login"],
    ["the sign-up page", "/fa/account/signup?next=/fa"],
    ["the verify link", "/en/account/verify?token=x"],
    ["an API", "/api/admin/uploads"],
    ["a media file", "/media/x"],
    ["Next's files", "/_next/static/x.js"],
    ["nothing", ""],
    ["a non-string", ["/tr"]],
    ["something too long", `/workshops/${"a".repeat(400)}`],
  ])("refuses %s", (_name, next) => {
    expect(safeNext(next, "member", FALLBACK, MAIN)).toBe(FALLBACK)
  })
})

describe("safeNext for instructors", () => {
  it("keeps pages of the instructor panel only", () => {
    expect(safeNext("/fa/instructor/contracts?c=1", "instructor", "/fa/instructor", MAIN)).toBe("/fa/instructor/contracts?c=1")
    expect(safeNext("/instructor/contracts/c1", "instructor", "x", MAIN)).toBe("/instructor/contracts/c1")
    expect(safeNext("/fa/instructor", "instructor", "x", MAIN)).toBe("/fa/instructor")
    expect(safeNext("/tr/instructor/contracts?c=1", "instructor", "x", MAIN)).toBe("/instructor/contracts?c=1")
    for (const next of [
      "/fa/workshops",
      "/fa/admin",
      "/fa/instructor/login",
      "/instructor/invite?token=t",
      "/fa/instructor/accept-invite?token=t",
      "/fa/instructors",
    ]) {
      expect(safeNext(next, "instructor", "/fa/instructor", MAIN), next).toBe("/fa/instructor")
    }
  })
})

describe("safeNext for admins", () => {
  it("keeps private pages of the admin panel, path only", () => {
    for (const next of ["/admin", "/admin/categories/new", "/fa/admin/workshops/w1/edit", "/en/admin/money/refunds"]) {
      expect(safeNext(next, "admin", "/admin", MAIN), next).toBe(next)
    }
    expect(safeNext("/tr/admin/categories", "admin", "/admin", MAIN)).toBe("/admin/categories")
    expect(safeNext("/EN/admin", "admin", "/admin", MAIN)).toBe("/en/admin")
    for (const next of [
      "/admin?x=1",
      "/admin/login",
      "/admin/forgot",
      "/admin/reset?token=t",
      "/admin/invite?token=t",
      "/admin/login/forgot",
      "/admin/workshops/w1/registrations/export",
      "/workshops",
      "/instructor",
      "/api/admin/uploads",
      "//evil.example/admin",
    ]) {
      expect(safeNext(next, "admin", "/fa/admin", MAIN), next).toBe("/fa/admin")
    }
  })
})
