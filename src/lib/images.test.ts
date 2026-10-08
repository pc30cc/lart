import { crc32 } from "node:zlib"
import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { applyWatermark, MAX_INPUT_PIXELS, processImage, renderWatermarkPreview } from "./images"

const solid = (width: number, height: number, color = { r: 20, g: 120, b: 200 }) =>
  sharp({ create: { width, height, channels: 3, background: color } })

/** A JPEG with GPS + camera EXIF and orientation 6 (stored sideways, shown rotated 90°). */
const phoneJpeg = (width: number, height: number) =>
  solid(width, height)
    .jpeg()
    .withExif({
      IFD0: { Make: "PhoneMaker", Model: "Phone 12", Copyright: "secret owner" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "28/1 58/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer()

describe("processImage", () => {
  it("auto-rotates, strips all metadata and outputs WebP", async () => {
    const input = await phoneJpeg(1200, 800)
    expect((await sharp(input).metadata()).exif).toBeDefined()

    const out = await processImage(input, "course_sample")
    const meta = await sharp(out.data).metadata()
    expect(meta.format).toBe("webp")
    expect(out.contentType).toBe("image/webp")
    // Stored 1200×800 sideways → upright 800×1200.
    expect([meta.width, meta.height]).toEqual([800, 1200])
    expect(meta.exif).toBeUndefined()
    expect(meta.xmp).toBeUndefined()
    expect(meta.iptc).toBeUndefined()
    expect(meta.orientation).toBeUndefined()
    expect(out.data.includes("PhoneMaker")).toBe(false)
    expect(out.data.includes("GPS")).toBe(false)
  })

  it.each([
    ["instructor_photo", [3000, 2000], [800, 800]],
    ["instructor_photo", [600, 900], [600, 600]],
    ["admin_photo", [3000, 2000], [512, 512]],
    ["admin_photo", [300, 500], [300, 300]],
    ["course_cover", [4000, 3000], [2000, 1500]],
    ["course_cover", [1000, 500], [1000, 500]],
    ["course_sample", [1000, 3200], [500, 1600]],
    ["gallery_photo", [4800, 3200], [2400, 1600]],
    ["watermark_logo", [2000, 500], [1000, 250]],
    ["site_image", [4000, 3000], [2560, 1920]],
    ["site_image", [1200, 3000], [1200, 3000]],
  ] as const)("%s %j → %j", async (purpose, [w, h], expected) => {
    const out = await processImage(await solid(w, h).png().toBuffer(), purpose)
    expect([out.width, out.height]).toEqual(expected)
    const meta = await sharp(out.data).metadata()
    expect([meta.width, meta.height]).toEqual(expected)
  })

  it("keeps the logo's transparency as PNG", async () => {
    const logo = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer()
    const out = await processImage(logo, "watermark_logo")
    const meta = await sharp(out.data).metadata()
    expect([meta.format, out.ext, meta.hasAlpha]).toEqual(["png", "png", true])
  })

  it("reads WebP and AVIF", async () => {
    for (const input of [await solid(64, 48).webp().toBuffer(), await solid(64, 48).avif().toBuffer()]) {
      expect((await processImage(input, "course_sample")).width).toBe(64)
    }
  })

  it.each([
    ["gif", () => solid(10, 10).gif().toBuffer(), "unsupported_type"],
    ["tiff", () => solid(10, 10).tiff().toBuffer(), "unsupported_type"],
    ["svg", async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), "unsupported_type"],
    ["text named .jpg", async () => Buffer.from("hello"), "unsupported_type"],
    ["broken jpeg", async () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]), "invalid_image"],
  ])("rejects %s", async (_, make, code) => {
    await expect(processImage(await make(), "course_cover")).rejects.toMatchObject({ code })
  })

  it("rejects images with too many pixels before decoding them", async () => {
    // A tiny PNG whose header claims a huge size (decompression bomb shape).
    const bomb = await solid(8, 8).png().toBuffer()
    const side = Math.ceil(Math.sqrt(MAX_INPUT_PIXELS)) + 1
    bomb.writeUInt32BE(side, 16)
    bomb.writeUInt32BE(side, 20)
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29)
    expect((await sharp(bomb).metadata()).width).toBe(side)
    await expect(processImage(bomb, "gallery_photo")).rejects.toMatchObject({ code: "too_many_pixels" })
  })
})

describe("applyWatermark", () => {
  const W = 1000
  const H = 600
  const black = () => solid(W, H, { r: 0, g: 0, b: 0 }).png().toBuffer()
  const whiteLogo = () => solid(100, 100, { r: 255, g: 255, b: 255 }).png().toBuffer()
  const layout = { sizePct: 10, opacity: 1, marginPct: 2 } // logo 100 px wide, margin 20 px

  async function render(position: Parameters<typeof applyWatermark>[1]["position"], opacity = 1) {
    const image = await applyWatermark(await black(), { ...layout, opacity, position }, await whiteLogo())
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
    return (x: number, y: number) => data[(y * info.width + x) * info.channels]
  }

  it.each([
    ["top-left", [70, 70]],
    ["top", [500, 70]],
    ["top-right", [930, 70]],
    ["left", [70, 300]],
    ["center", [500, 300]],
    ["right", [930, 300]],
    ["bottom-left", [70, 530]],
    ["bottom", [500, 530]],
    ["bottom-right", [930, 530]],
  ] as const)("places the logo %s", async (position, [x, y]) => {
    const pixel = await render(position)
    expect(pixel(x, y)).toBe(255)
    // Corners of the logo box: inside at margin, outside just before it.
    const left = x - 50
    const top = y - 50
    expect(pixel(left, top)).toBe(255)
    expect(pixel(left + 99, top + 99)).toBe(255)
    if (left > 0) expect(pixel(left - 1, top)).toBe(0)
    if (top > 0) expect(pixel(left, top - 1)).toBe(0)
    // Far away from it: untouched.
    expect(pixel(x < 500 ? 990 : 5, y < 300 ? 595 : 5)).toBe(0)
  })

  it("keeps the margin from the edges", async () => {
    const pixel = await render("bottom-right")
    expect(pixel(880, 480)).toBe(255)
    expect(pixel(979, 579)).toBe(255)
    expect(pixel(980, 579)).toBe(0)
    expect(pixel(979, 580)).toBe(0)
  })

  it("applies the opacity", async () => {
    const pixel = await render("center", 0.5)
    expect(pixel(500, 300)).toBeGreaterThan(115)
    expect(pixel(500, 300)).toBeLessThan(140)
  })

  it("tiles the logo with gaps", async () => {
    const pixel = await render("tiled")
    // Tiles of 100 px with a 50 px gap: 0–99, 150–249, 300–399, ...
    for (const [x, y, value] of [
      [50, 50, 255], [200, 50, 255], [350, 200, 255], [950, 500, 255],
      [125, 50, 0], [50, 125, 0], [275, 275, 0],
    ]) {
      expect(pixel(x, y), `${x},${y}`).toBe(value)
    }
  })

  it("watermarks gallery photos during processing", async () => {
    const out = await processImage(await solid(2000, 1000, { r: 0, g: 0, b: 0 }).jpeg().toBuffer(), "gallery_photo", {
      settings: { position: "top-left", sizePct: 10, opacity: 1, marginPct: 0 },
      logo: await whiteLogo(),
    })
    const { data, info } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => data[(y * info.width + x) * info.channels]
    expect(pixel(100, 100)).toBeGreaterThan(240)
    expect(pixel(1500, 800)).toBeLessThan(15)
  })
})

describe("renderWatermarkPreview", () => {
  it("renders the sample photo, with and without a logo", async () => {
    const settings = { position: "center", sizePct: 20, opacity: 1, marginPct: 3 } as const
    const plain = await renderWatermarkPreview(settings)
    const marked = await renderWatermarkPreview(settings, await solid(50, 50, { r: 255, g: 0, b: 0 }).png().toBuffer())
    for (const preview of [plain, marked]) {
      const meta = await sharp(preview).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", 1200, 800])
    }
    const { data, info } = await sharp(marked).raw().toBuffer({ resolveWithObject: true })
    const centre = (400 * info.width + 600) * info.channels
    expect([data[centre] > 200, data[centre + 1] < 60]).toEqual([true, true])
  })
})
