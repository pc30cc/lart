import { describe, expect, it } from "vitest"

import { newObjectPath } from "./index"
import { isSafePath, maxUploadBytes, mediaContentType } from "./shared"

describe("isSafePath", () => {
  it.each([
    "gallery/2026-10/AbC_-123.webp",
    "originals/2026-10/x.webp",
    "brand/2026-10/logo.png",
    "_probe/2026-10/abc.txt",
  ])("accepts %s", (path) => expect(isSafePath(path)).toBe(true))

  it.each([
    "",
    "file.webp",
    "/gallery/a.webp",
    "gallery/../a.webp",
    "gallery/..%2fa.webp",
    "../gallery/a.webp",
    "gallery/./a.webp",
    "gallery//a.webp",
    "gallery/a.webp/",
    "gallery\\a.webp",
    "gallery/a.b.webp",
    "gallery/a",
    "gallery/a.WEBP",
    "gallery/a b.webp",
    "gallery/a.webp\0",
    "galerie/عکس.webp",
    "a/b/c/d/e/f/g.webp",
    `gallery/${"a".repeat(65)}.webp`,
  ])("rejects %j", (path) => expect(isSafePath(path)).toBe(false))

  it("rejects non-strings", () => {
    expect(isSafePath(undefined)).toBe(false)
    expect(isSafePath(["gallery", "a.webp"])).toBe(false)
  })
})

describe("newObjectPath", () => {
  it("is random, safe and keeps no original name", () => {
    const a = newObjectPath("gallery", "webp")
    const b = newObjectPath("gallery", "webp")
    expect(a).not.toBe(b)
    expect(isSafePath(a)).toBe(true)
    expect(a).toMatch(/^gallery\/\d{4}-\d{2}\/[A-Za-z0-9_-]{22}\.webp$/)
  })
  it("refuses unsafe prefixes and extensions", () => {
    expect(() => newObjectPath("../x", "webp")).toThrow()
    expect(() => newObjectPath("gallery", "php.webp")).toThrow()
  })
})

describe("limits and content types", () => {
  it("allows big videos and smaller images", () => {
    expect(maxUploadBytes("gallery_video")).toBe(500 * 1024 * 1024)
    expect(maxUploadBytes("course_cover")).toBe(15 * 1024 * 1024)
  })
  it("maps only media extensions", () => {
    expect(mediaContentType("a/b.webp")).toBe("image/webp")
    expect(mediaContentType("a/b.mov")).toBe("video/quicktime")
    expect(mediaContentType("a/b.txt")).toBeNull()
    expect(mediaContentType("a/b.html")).toBeNull()
    expect(mediaContentType("a/b.constructor")).toBeNull()
  })
})
