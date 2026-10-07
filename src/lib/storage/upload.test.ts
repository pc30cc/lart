import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { settingDefaults } from "@/lib/settings"
import { createStorage, type Storage } from "./index"
import { localDriver } from "./local"
import { PartMismatch, storeImage, storeVideoPart, uploadPath } from "./upload"

let root: string
let storage: Storage
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lart-upload-"))
  storage = createStorage(localDriver(root))
})
afterEach(() => rm(root, { recursive: true, force: true }))

const toStream = (data: Buffer) => new Blob([new Uint8Array(data)]).stream()
const jpeg = (width: number, height: number, color = { r: 0, g: 0, b: 0 }) =>
  sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer()
const read = async (p: string) => Buffer.from(await new Response((await localDriver(root).get(p))!.body).arrayBuffer())
/** Every stored file's path. */
const files = async () =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)))
    .sort()
const noWatermark = { ...settingDefaults.watermark, logoPath: null }
const pixel = async (p: string, x: number, y: number) => {
  const { data, info } = await sharp(await read(p)).raw().toBuffer({ resolveWithObject: true })
  return data[(y * info.width + x) * info.channels]
}
/** Upload a white square logo and answer settings that put it in the top-left corner at 10 % width. */
async function withLogo() {
  const logo = await storeImage({
    storage,
    purpose: "watermark_logo",
    file: toStream(await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer()),
    watermark: noWatermark,
  })
  return { ...settingDefaults.watermark, logoPath: logo.path, position: "top-left", sizePct: 10, marginPct: 0, opacity: 1 } as const
}

describe("uploadPath", () => {
  const rand = "[\\w-]{22}"
  it.each([
    ["course_cover", "Mum Yapımı", "webp", `workshops/mum-yapimi/cover-${rand}\\.webp`],
    ["course_sample", "mum-yapimi", "webp", `workshops/mum-yapimi/samples/${rand}\\.webp`],
    ["gallery_photo", "mum-yapimi", "webp", `workshops/mum-yapimi/gallery/${rand}\\.webp`],
    ["gallery_video", "mum-yapimi", "mov", `workshops/mum-yapimi/videos/${rand}\\.mov`],
    ["instructor_photo", "Çiğdem Işık", "webp", `instructors/cigdem-isik/photo-${rand}\\.webp`],
    ["admin_photo", "mina", "webp", `partners/mina/photo-${rand}\\.webp`],
    ["watermark_logo", "anything", "png", `brand/watermark-logo-${rand}\\.png`],
  ] as const)("puts %s files in their folder", (purpose, folder, ext, pattern) => {
    const p = uploadPath(purpose, folder, ext)
    expect(p).toMatch(new RegExp(`^${pattern}$`))
    expect(uploadPath(purpose, folder, ext)).not.toBe(p)
  })

  it("never lets a folder name leave its folder", () => {
    expect(uploadPath("course_cover", "../../brand", "webp")).toMatch(/^workshops\/brand\/cover-/)
    expect(uploadPath("admin_photo", "x/../../../etc", "webp")).toMatch(/^partners\/x-etc\/photo-/)
    expect(uploadPath("instructor_photo", "مریم", "webp")).toMatch(/^instructors\/unnamed\/photo-/)
    expect(uploadPath("course_sample", undefined, "webp")).toMatch(/^workshops\/unnamed\/samples\//)
  })
})

describe("storeImage", () => {
  it("stores a processed image in the workshop's folder", async () => {
    const result = await storeImage({
      storage,
      purpose: "course_cover",
      file: toStream(await jpeg(3000, 1000)),
      watermark: noWatermark,
      folder: "mum-yapimi",
    })
    expect(result).toMatchObject({ width: 2000, height: 667, url: `/media/${result.path}` })
    expect(result.path).toMatch(/^workshops\/mum-yapimi\/cover-[\w-]{22}\.webp$/)
    expect((await sharp(await read(result.path)).metadata()).format).toBe("webp")
    expect(await files()).toEqual([result.path])
  })

  it("stores the watermark logo like any other file, with a public URL", async () => {
    const logo = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer()
    const result = await storeImage({ storage, purpose: "watermark_logo", file: toStream(logo), watermark: noWatermark })
    expect(result.path).toMatch(/^brand\/watermark-logo-[\w-]{22}\.png$/)
    expect(result.url).toBe(`/media/${result.path}`)
    expect((await read(result.path)).length).toBeGreaterThan(0)
  })

  it("stores a partner's photo as a small square in their folder, with a public URL", async () => {
    const result = await storeImage({ storage, purpose: "admin_photo", file: toStream(await jpeg(1200, 900)), watermark: noWatermark, folder: "mina" })
    expect(result).toMatchObject({ width: 512, height: 512, url: `/media/${result.path}` })
    expect(result.path).toMatch(/^partners\/mina\/photo-[\w-]{22}\.webp$/)
    expect((await sharp(await read(result.path)).metadata()).format).toBe("webp")
  })

  it("stores only the watermarked gallery photo, never the original", async () => {
    const watermark = await withLogo()
    const before = await files()
    const result = await storeImage({
      storage,
      purpose: "gallery_photo",
      file: toStream(await jpeg(3000, 2000)),
      watermark,
      folder: "mum-yapimi",
    })
    expect(result).toEqual({ path: expect.any(String), url: `/media/${result.path}`, width: 2400, height: 1600 })
    expect(result.path).toMatch(/^workshops\/mum-yapimi\/gallery\/[\w-]{22}\.webp$/)
    expect(await pixel(result.path, 100, 100)).toBeGreaterThan(240)
    expect(await files()).toEqual([...before, result.path].sort())
  })

  it("refuses gallery photos while no watermark logo is set, storing nothing", async () => {
    await expect(
      storeImage({ storage, purpose: "gallery_photo", file: toStream(await jpeg(100, 100)), watermark: noWatermark }),
    ).rejects.toMatchObject({ code: "watermark_missing", status: 409 })
    expect(await files().catch(() => [])).toEqual([])
  })

  it("watermarks gallery photos even when a stored setting says the watermark is off", async () => {
    // Settings saved before the on/off switch was removed may still carry `enabled: false`.
    const stored = { ...(await withLogo()), enabled: false }
    const result = await storeImage({ storage, purpose: "gallery_photo", file: toStream(await jpeg(1000, 1000)), watermark: stored })
    expect(await pixel(result.path, 50, 50)).toBeGreaterThan(240)
  })

  it("refuses to publish when the saved logo is missing", async () => {
    const watermark = { ...settingDefaults.watermark, logoPath: "brand/2026-10/missing.png" }
    await expect(storeImage({ storage, purpose: "gallery_photo", file: toStream(await jpeg(100, 100)), watermark })).rejects.toMatchObject({
      code: "watermark_unavailable",
    })
    expect(await files().catch(() => [])).toEqual([])
  })
})

describe("storeVideoPart", () => {
  const video = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42\0\0\0\0mp42isom"), Buffer.alloc(300_000, 9)])
  const leftovers = async () => (await readdir(os.tmpdir())).filter((n) => n.startsWith("lart-video-admin-1-"))
  // Abandoned uploads stay until swept a day later; tests remove theirs.
  afterEach(async () => Promise.all((await leftovers()).map((n) => rm(path.join(os.tmpdir(), n), { force: true }))))
  const part = (from: number, to?: number) => toStream(video.subarray(from, to))

  it("stores a whole video sent at once, under a random name in the workshop's folder", async () => {
    const result = await storeVideoPart({ storage, owner: "admin-1", file: part(0), folder: "mum-yapimi" })
    expect("path" in result && result.path).toMatch(/^workshops\/mum-yapimi\/videos\/[\w-]{22}\.mp4$/)
    if (!("path" in result)) throw new Error("not stored")
    expect(result.url).toBe(`/media/${result.path}`)
    expect((await read(result.path)).equals(video)).toBe(true)
    expect(await leftovers()).toEqual([])
  })

  it("assembles a video sent in parts and stores it only when complete", async () => {
    const total = video.length
    const first = await storeVideoPart({ storage, owner: "admin-1", file: part(0, 100_000), total })
    expect(first).toMatchObject({ received: 100_000 })
    if ("path" in first) throw new Error("stored too early")
    expect(await files().catch(() => [])).toEqual([])

    const second = await storeVideoPart({ storage, owner: "admin-1", file: part(100_000, 200_000), upload: first.upload, offset: 100_000, total })
    expect(second).toEqual({ upload: first.upload, received: 200_000 })

    // A repeated part (its answer was lost) tells the client where to continue.
    const again = await storeVideoPart({ storage, owner: "admin-1", file: part(100_000, 200_000), upload: first.upload, offset: 100_000, total }).catch((e) => e)
    expect(again).toBeInstanceOf(PartMismatch)
    expect(again.received).toEqual({ upload: first.upload, received: 200_000 })

    const last = await storeVideoPart({ storage, owner: "admin-1", file: part(200_000), upload: first.upload, offset: 200_000, total })
    if (!("path" in last)) throw new Error("not stored")
    expect((await read(last.path)).equals(video)).toBe(true)
    expect(await leftovers()).toEqual([])
  })

  it("does not let another admin continue an upload", async () => {
    const first = await storeVideoPart({ storage, owner: "admin-1", file: part(0, 1000), total: video.length })
    if ("path" in first) throw new Error("stored too early")
    await expect(
      storeVideoPart({ storage, owner: "admin-2", file: part(1000, 2000), upload: first.upload, offset: 1000, total: video.length }),
    ).rejects.toMatchObject({ code: "bad_request" })
  })

  it("refuses a part that is too long for the declared total", async () => {
    const first = await storeVideoPart({ storage, owner: "admin-1", file: part(0, 1000), total: 1500 }).catch((e) => e)
    expect(first).toMatchObject({ upload: expect.any(String), received: 1000 })
    // The route limits the stream to total - offset; here the store refuses the size mismatch.
    await expect(
      storeVideoPart({ storage, owner: "admin-1", file: part(1000, 2000), upload: first.upload, offset: 1000, total: 1500 }),
    ).rejects.toMatchObject({ code: "bad_request" })
    expect(await leftovers()).toEqual([])
  })

  it.each([
    ["an offset without an upload id", { offset: 10 }],
    ["a malformed upload id", { upload: "../../etc/passwd", offset: 0 }],
    ["an unknown upload id", { upload: "AAAAAAAAAAAAAAAAAAAAAA", offset: 10 }],
  ])("refuses %s", async (_, extra) => {
    await expect(storeVideoPart({ storage, owner: "admin-1", file: part(0, 100), total: video.length, ...extra })).rejects.toMatchObject({
      code: "bad_request",
    })
  })

  it("refuses videos over the size limit before reading them", async () => {
    await expect(storeVideoPart({ storage, owner: "admin-1", file: part(0, 10), total: 501 * 1024 * 1024 })).rejects.toMatchObject({
      code: "too_large",
    })
  })

  it("rejects a file that is not a video from its first part", async () => {
    const fake = Buffer.concat([Buffer.from("<html><script>alert(1)</script>"), Buffer.alloc(100)])
    await expect(storeVideoPart({ storage, owner: "admin-1", file: toStream(fake), total: 10_000 })).rejects.toMatchObject({
      code: "unsupported_type",
    })
    expect(await files().catch(() => [])).toEqual([])
    expect(await leftovers()).toEqual([])
  })
})
