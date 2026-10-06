import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { settingDefaults } from "@/lib/settings"
import { createStorage, type Storage } from "./index"
import { localDriver } from "./local"
import { PartMismatch, storeImage, storeVideoPart } from "./upload"

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
const read = async (zone: "public" | "private", p: string) =>
  Buffer.from(await new Response((await localDriver(root).get(zone, p))!.body).arrayBuffer())
const files = async (zone: "public" | "private") =>
  (await readdir(path.join(root, zone), { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length
const noWatermark = { ...settingDefaults.watermark, logoPath: null }
const pixel = async (zone: "public" | "private", p: string, x: number, y: number) => {
  const { data, info } = await sharp(await read(zone, p)).raw().toBuffer({ resolveWithObject: true })
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

describe("storeImage", () => {
  it("stores a processed public image", async () => {
    const result = await storeImage({ storage, purpose: "course_cover", file: toStream(await jpeg(3000, 1000)), watermark: noWatermark })
    expect(result).toMatchObject({ width: 2000, height: 667, url: `/media/${result.path}` })
    expect(result.path).toMatch(/^courses\/\d{4}-\d{2}\/[\w-]{22}\.webp$/)
    expect((await sharp(await read("public", result.path)).metadata()).format).toBe("webp")
    expect(await files("private").catch(() => 0)).toBe(0)
  })

  it("keeps the watermark logo private", async () => {
    const logo = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer()
    const result = await storeImage({ storage, purpose: "watermark_logo", file: toStream(logo), watermark: noWatermark })
    expect(result.path).toMatch(/^brand\/.+\.png$/)
    expect(result.url).toBe(`/api/admin/media/private/${result.path}`)
    expect((await read("private", result.path)).length).toBeGreaterThan(0)
  })

  it("stores a watermarked gallery photo and its private original", async () => {
    const watermark = await withLogo()
    const result = await storeImage({ storage, purpose: "gallery_photo", file: toStream(await jpeg(3000, 2000)), watermark })
    expect(result).toMatchObject({ width: 2400, height: 1600 })
    expect(result.path).toMatch(/^gallery\//)
    expect(result.originalPath).toMatch(/^originals\//)

    expect(await pixel("public", result.path, 100, 100)).toBeGreaterThan(240)
    expect(await pixel("private", result.originalPath!, 100, 100)).toBeLessThan(15)
    expect((await sharp(await read("private", result.originalPath!)).metadata()).width).toBe(3000)
  })

  it("refuses gallery photos while no watermark logo is set, storing nothing", async () => {
    await expect(
      storeImage({ storage, purpose: "gallery_photo", file: toStream(await jpeg(100, 100)), watermark: noWatermark }),
    ).rejects.toMatchObject({ code: "watermark_missing", status: 409 })
    expect(await files("public").catch(() => 0)).toBe(0)
    expect(await files("private").catch(() => 0)).toBe(0)
  })

  it("watermarks gallery photos even when a stored setting says the watermark is off", async () => {
    // Settings saved before the on/off switch was removed may still carry `enabled: false`.
    const stored = { ...(await withLogo()), enabled: false }
    const result = await storeImage({ storage, purpose: "gallery_photo", file: toStream(await jpeg(1000, 1000)), watermark: stored })
    expect(await pixel("public", result.path, 50, 50)).toBeGreaterThan(240)
    expect(await pixel("private", result.originalPath!, 50, 50)).toBeLessThan(15)
  })

  it("refuses to publish when the saved logo is missing", async () => {
    const watermark = { ...settingDefaults.watermark, logoPath: "brand/2026-10/missing.png" }
    await expect(storeImage({ storage, purpose: "gallery_photo", file: toStream(await jpeg(100, 100)), watermark })).rejects.toMatchObject({
      code: "watermark_unavailable",
    })
    expect(await files("public").catch(() => 0)).toBe(0)
  })
})

describe("storeVideoPart", () => {
  const video = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42\0\0\0\0mp42isom"), Buffer.alloc(300_000, 9)])
  const leftovers = async () => (await readdir(os.tmpdir())).filter((n) => n.startsWith("lart-video-admin-1-"))
  // Abandoned uploads stay until swept a day later; tests remove theirs.
  afterEach(async () => Promise.all((await leftovers()).map((n) => rm(path.join(os.tmpdir(), n), { force: true }))))
  const part = (from: number, to?: number) => toStream(video.subarray(from, to))

  it("stores a whole video sent at once, under a random name", async () => {
    const result = await storeVideoPart({ storage, owner: "admin-1", file: part(0) })
    expect("path" in result && result.path).toMatch(/^gallery\/\d{4}-\d{2}\/[\w-]{22}\.mp4$/)
    if (!("path" in result)) throw new Error("not stored")
    expect(result.url).toBe(`/media/${result.path}`)
    expect((await read("public", result.path)).equals(video)).toBe(true)
    expect(await leftovers()).toEqual([])
  })

  it("assembles a video sent in parts and stores it only when complete", async () => {
    const total = video.length
    const first = await storeVideoPart({ storage, owner: "admin-1", file: part(0, 100_000), total })
    expect(first).toMatchObject({ received: 100_000 })
    if ("path" in first) throw new Error("stored too early")
    expect(await files("public").catch(() => 0)).toBe(0)

    const second = await storeVideoPart({ storage, owner: "admin-1", file: part(100_000, 200_000), upload: first.upload, offset: 100_000, total })
    expect(second).toEqual({ upload: first.upload, received: 200_000 })

    // A repeated part (its answer was lost) tells the client where to continue.
    const again = await storeVideoPart({ storage, owner: "admin-1", file: part(100_000, 200_000), upload: first.upload, offset: 100_000, total }).catch((e) => e)
    expect(again).toBeInstanceOf(PartMismatch)
    expect(again.received).toEqual({ upload: first.upload, received: 200_000 })

    const last = await storeVideoPart({ storage, owner: "admin-1", file: part(200_000), upload: first.upload, offset: 200_000, total })
    if (!("path" in last)) throw new Error("not stored")
    expect((await read("public", last.path)).equals(video)).toBe(true)
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
    expect(await files("public").catch(() => 0)).toBe(0)
    expect(await leftovers()).toEqual([])
  })
})
