import { describe, expect, it } from "vitest"

import { newObjectPath } from "./index"
import { folderName, isImagePurpose, isSafePath, maxUploadBytes, mediaContentType, uploadPurposes, videoFormats, videoPurposes } from "./shared"

describe("isSafePath", () => {
  it.each([
    "gallery/2026-10/AbC_-123.webp",
    "brand/2026-10/logo.png",
    `workshops/${"a".repeat(60)}/gallery/AbC_-123AbC_-123AbC_-1.webp`,
    `workshops/x/cover-${"a".repeat(22)}.webp`,
    `brand/watermark-logo-${"a".repeat(22)}.png`,
    "_probe/abc.txt",
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
    const a = newObjectPath("workshops/mum/gallery", "webp")
    const b = newObjectPath("workshops/mum/gallery", "webp")
    expect(a).not.toBe(b)
    expect(isSafePath(a)).toBe(true)
    expect(a).toMatch(/^workshops\/mum\/gallery\/[A-Za-z0-9_-]{22}\.webp$/)
    expect(newObjectPath("workshops/mum", "webp", "cover-")).toMatch(/^workshops\/mum\/cover-[A-Za-z0-9_-]{22}\.webp$/)
  })
  it("refuses unsafe folders, names and extensions", () => {
    expect(() => newObjectPath("../x", "webp")).toThrow()
    expect(() => newObjectPath("gallery", "php.webp")).toThrow()
    expect(() => newObjectPath("gallery", "webp", "../")).toThrow()
  })
})

describe("folderName", () => {
  it.each([
    ["Mum Yapımı Atölyesi", "mum-yapimi-atolyesi"],
    ["Çiğdem Işık Öztürk-Şahin", "cigdem-isik-ozturk-sahin"],
    ["İPEK ÜNLÜ", "ipek-unlu"],
    ["  Seramik -- 101!  ", "seramik-101"],
    ["../../etc/passwd", "etc-passwd"],
    ["a/b\\c%2e%2e", "a-b-c-2e-2e"],
  ])("makes %j the folder %j", (name, folder) => {
    expect(folderName([name])).toBe(folder)
    expect(isSafePath(`workshops/${folderName([name])}/a.webp`)).toBe(true)
  })

  it("is at most 60 characters, without a hyphen at the end", () => {
    const folder = folderName([`${"ab ".repeat(40)}`])
    expect(folder.length).toBeLessThanOrEqual(60)
    expect(folder).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it("takes the first name that has Latin letters or digits, else the fallback", () => {
    expect(folderName(["مریم رضایی", "maryam.rezaei"])).toBe("maryam-rezaei")
    expect(folderName(["مریم رضایی"])).toBe("unnamed")
    expect(folderName([undefined, null, "", "..."], "new")).toBe("new")
  })
})

describe("limits and content types", () => {
  it("allows big videos and smaller images", () => {
    expect(maxUploadBytes("gallery_video")).toBe(500 * 1024 * 1024)
    expect(maxUploadBytes("course_cover")).toBe(15 * 1024 * 1024)
    expect(maxUploadBytes("site_image")).toBe(15 * 1024 * 1024)
    expect(maxUploadBytes("site_video")).toBe(80 * 1024 * 1024)
  })
  it("knows which purposes are videos and which formats they take", () => {
    expect(uploadPurposes.filter((p) => !isImagePurpose(p))).toEqual([...videoPurposes])
    expect(videoFormats.gallery_video).toEqual(["mp4", "mov", "webm"])
    // The home page's video autoplays: MOV does not in Chromium or Firefox.
    expect(videoFormats.site_video).toEqual(["mp4", "webm"])
  })
  it("maps only media extensions", () => {
    expect(mediaContentType("a/b.webp")).toBe("image/webp")
    expect(mediaContentType("a/b.mov")).toBe("video/quicktime")
    expect(mediaContentType("a/b.txt")).toBeNull()
    expect(mediaContentType("a/b.html")).toBeNull()
    expect(mediaContentType("a/b.constructor")).toBeNull()
  })
})
