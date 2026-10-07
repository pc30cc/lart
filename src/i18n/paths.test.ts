import { describe, expect, it } from "vitest"

import { localePath, splitLocale, stripLocale } from "./paths"

describe("localePath", () => {
  it.each([
    ["tr", "/", "tr", "/"],
    ["fa", "/", "tr", "/fa"],
    ["fa", "/?q=1", "tr", "/fa?q=1"],
    ["en", "/#top", "tr", "/en#top"],
    ["tr", "/workshops", "tr", "/workshops"],
    ["fa", "/workshops#x", "tr", "/fa/workshops#x"],
    ["en", "/account/login?next=%2Fworkshops", "tr", "/en/account/login?next=%2Fworkshops"],
    ["tr", "/workshops", "fa", "/tr/workshops"],
    ["fa", "/workshops", "fa", "/workshops"],
  ])("(%s, %s) with main %s → %s", (locale, path, main, expected) => {
    expect(localePath(locale, path, main)).toBe(expected)
  })
})

describe("splitLocale", () => {
  it.each([
    ["/", null, "/"],
    ["/fa", "fa", "/"],
    ["/fa/workshops", "fa", "/workshops"],
    ["/TR/x", "tr", "/x"],
    ["/tra", null, "/tra"],
    ["/workshops", null, "/workshops"],
    ["/de/workshops", null, "/de/workshops"],
  ])("%s → %s %s", (pathname, locale, rest) => {
    expect(splitLocale(pathname)).toEqual({ locale, rest })
  })
})

describe("stripLocale", () => {
  it.each([
    ["/fa", "fa", "/"],
    ["/fa/workshops", "fa", "/workshops"],
    ["/workshops", "fa", "/workshops"],
    ["/fax", "fa", "/fax"],
    ["/en/admin", "fa", "/en/admin"],
  ])("%s without %s → %s", (pathname, locale, expected) => {
    expect(stripLocale(pathname, locale)).toBe(expected)
  })
})
