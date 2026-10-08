import "server-only"
import type { Sharp } from "sharp"

import type { SettingValue } from "@/lib/settings"
import { MAX_MEGAPIXELS, UploadError, type ImagePurpose } from "@/lib/storage/shared"
import { sniffImage, type ImageType } from "@/lib/storage/sniff"

/**
 * Image pipeline: check the real type from the content, auto-rotate from
 * EXIF, strip all metadata (GPS and camera data never leave the server),
 * resize for the purpose and re-encode as WebP (the watermark logo as PNG).
 */

export type WatermarkSettings = SettingValue<"watermark">
type WatermarkLayout = Pick<WatermarkSettings, "position" | "sizePct" | "opacity" | "marginPct">

export type ProcessedImage = {
  data: Buffer
  width: number
  height: number
  ext: "webp" | "png"
  contentType: "image/webp" | "image/png"
}

/** A decoded image (raw pixels), e.g. between resizing and watermarking. */
export type RawImage = { data: Buffer; info: { width: number; height: number; channels: 1 | 2 | 3 | 4 } }

export const MAX_INPUT_PIXELS = MAX_MEGAPIXELS * 1_000_000
const WEBP_QUALITY = 82
const SHARP_FORMAT: Record<ImageType, string> = { jpeg: "jpeg", png: "png", webp: "webp", avif: "heif", heic: "heif" }

type SharpModule = (typeof import("sharp"))["default"]
let sharpModule: Promise<SharpModule> | undefined

/**
 * sharp is loaded on first use, not at import: its native and WebAssembly
 * builds need a CPU with SSE4 (x86-64-v2). On an older CPU the site still
 * builds and runs; only image uploads answer "processing_unavailable".
 */
async function loadSharp(): Promise<SharpModule> {
  sharpModule ??= import("sharp").then((m) => m.default)
  try {
    return await sharpModule
  } catch (error) {
    sharpModule = undefined
    console.error("[images] sharp cannot run on this server:", error instanceof Error ? error.message.split("\n")[0] : error)
    throw new UploadError("processing_unavailable")
  }
}

const load = async (input: Buffer) => (await loadSharp())(input, { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true })

/** Checks the type and size before any pixel is decoded. Returns the type and the upright size. */
async function inspect(input: Buffer) {
  const type = sniffImage(input)
  if (!type) throw new UploadError("unsupported_type")
  const sharp = await loadSharp()
  const meta = await sharp(input, { limitInputPixels: false })
    .metadata()
    .catch(() => {
      throw new UploadError(type === "heic" ? "heic_unsupported" : "invalid_image")
    })
  if (meta.format !== SHARP_FORMAT[type]) throw new UploadError("invalid_image")
  if (type === "heic" && meta.compression === "hevc" && !sharp.format.heif.input.fileSuffix?.includes(".heic")) {
    throw new UploadError("heic_unsupported")
  }
  if (!meta.width || !meta.height) throw new UploadError("invalid_image")
  if (meta.width * meta.height > MAX_INPUT_PIXELS) throw new UploadError("too_many_pixels")
  return { type, width: meta.autoOrient.width, height: meta.autoOrient.height }
}

/** Decoding errors become friendly upload errors. */
async function guard<T>(type: ImageType, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof UploadError) throw error
    if (error instanceof Error && /pixel limit/i.test(error.message)) throw new UploadError("too_many_pixels")
    throw new UploadError(type === "heic" ? "heic_unsupported" : "invalid_image")
  }
}

async function encode(image: Sharp, format: "webp" | "png"): Promise<ProcessedImage> {
  const out = format === "png" ? image.png({ compressionLevel: 9 }) : image.webp({ quality: WEBP_QUALITY })
  const { data, info } = await out.toBuffer({ resolveWithObject: true })
  return {
    data,
    width: info.width,
    height: info.height,
    ext: format,
    contentType: format === "png" ? "image/png" : "image/webp",
  }
}

/**
 * Process an upload for its purpose:
 * - instructor_photo: square centre crop, 800 × 800 at most
 * - admin_photo: square centre crop, 512 × 512 at most (a partner's avatar in the panel)
 * - partner_portrait: at most 1600 on the longest side, not cropped (the About page frames it)
 * - course_cover: at most 2000 wide
 * - course_sample: at most 1600 on the longest side
 * - gallery_photo: at most 2400 on the longest side, watermarked when a logo is given
 * - watermark_logo: PNG with its transparency, at most 1000 on the longest side
 * - site_image: at most 2560 wide (the home page's photos, shown full width), never watermarked
 */
export async function processImage(
  input: Buffer,
  purpose: ImagePurpose,
  watermark?: { settings: WatermarkLayout; logo: Buffer } | null,
): Promise<ProcessedImage> {
  const { type, width, height } = await inspect(input)
  return guard(type, async () => {
    const image = await load(input)
    switch (purpose) {
      case "instructor_photo": {
        const side = Math.min(800, width, height)
        return encode(image.resize(side, side, { fit: "cover", position: "centre" }), "webp")
      }
      case "admin_photo": {
        const side = Math.min(512, width, height)
        return encode(image.resize(side, side, { fit: "cover", position: "centre" }), "webp")
      }
      case "partner_portrait":
        return encode(image.resize(1600, 1600, { fit: "inside", withoutEnlargement: true }), "webp")
      case "course_cover":
        return encode(image.resize({ width: 2000, withoutEnlargement: true }), "webp")
      case "site_image":
        return encode(image.resize({ width: 2560, withoutEnlargement: true }), "webp")
      case "course_sample":
        return encode(image.resize(1600, 1600, { fit: "inside", withoutEnlargement: true }), "webp")
      case "watermark_logo":
        return encode(image.resize(1000, 1000, { fit: "inside", withoutEnlargement: true }), "png")
      case "gallery_photo": {
        const resized = image.resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
        if (!watermark) return encode(resized, "webp")
        const raw = (await resized.raw().toBuffer({ resolveWithObject: true })) as RawImage
        return encode(await applyWatermark(raw, watermark.settings, watermark.logo), "webp")
      }
    }
  })
}

const GRID: Record<Exclude<WatermarkSettings["position"], "tiled">, [column: 0 | 1 | 2, row: 0 | 1 | 2]> = {
  "top-left": [0, 0], top: [1, 0], "top-right": [2, 0],
  left: [0, 1], center: [1, 1], right: [2, 1],
  "bottom-left": [0, 2], bottom: [1, 2], "bottom-right": [2, 2],
}

const place = (slot: 0 | 1 | 2, outer: number, inner: number, margin: number) =>
  Math.max(0, Math.min(outer - inner, slot === 0 ? margin : slot === 1 ? Math.round((outer - inner) / 2) : outer - inner - margin))

/**
 * Put the logo on an image: one of nine positions or tiled, its width a
 * percentage of the photo width, with the given opacity and margin (a
 * percentage of the photo width). Returns the pipeline, ready to encode.
 */
export async function applyWatermark(image: Buffer | RawImage, settings: WatermarkLayout, logo: Buffer): Promise<Sharp> {
  const sharp = await loadSharp()
  let base: Sharp
  let width: number
  let height: number
  if (Buffer.isBuffer(image)) {
    base = sharp(image, { autoOrient: true })
    ;({ width, height } = (await base.metadata()).autoOrient)
  } else {
    base = sharp(image.data, { raw: image.info })
    ;({ width, height } = image.info)
  }

  const margin = Math.round((width * settings.marginPct) / 100)
  const alpha = Buffer.from([255, 255, 255, Math.round(settings.opacity * 255)])
  const mark = await sharp(logo, { limitInputPixels: MAX_INPUT_PIXELS })
    .ensureAlpha()
    .resize(Math.max(1, Math.round((width * settings.sizePct) / 100)), Math.max(1, height - 2 * margin), { fit: "inside" })
    // Scale the logo's own transparency by the opacity.
    .composite([{ input: alpha, raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" }])
    .png()
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw new UploadError("watermark_unavailable")
    })
  const { width: w, height: h } = mark.info

  if (settings.position === "tiled") {
    const gap = Math.max(margin, Math.round(w / 2))
    const tile = await sharp(mark.data)
      .extend({
        right: Math.min(gap, width - w),
        bottom: Math.min(gap, height - h),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer()
    return base.composite([{ input: tile, tile: true, gravity: "northwest" }])
  }
  const [column, row] = GRID[settings.position]
  return base.composite([{ input: mark.data, left: place(column, width, w, margin), top: place(row, height, h, margin) }])
}

let samplePhoto: Promise<RawImage> | undefined

/** A neutral, photo-like sample (soft warm gradient with shapes), generated once. */
function getSamplePhoto() {
  samplePhoto ??= loadSharp().then((sharp) => sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d9d2c7"/><stop offset="1" stop-color="#8f8a83"/>
        </linearGradient>
        <filter id="soft"><feGaussianBlur stdDeviation="40"/></filter>
      </defs>
      <rect width="1200" height="800" fill="url(#bg)"/>
      <g filter="url(#soft)">
        <circle cx="330" cy="300" r="190" fill="#f3eee6"/>
        <ellipse cx="820" cy="560" rx="300" ry="150" fill="#6f6a64"/>
        <circle cx="900" cy="230" r="120" fill="#c9b9a3"/>
      </g>
      <rect x="0" y="610" width="1200" height="190" fill="#5f5b56" opacity="0.35"/>
    </svg>`),
  )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true }))
    .then((r) => r as RawImage)
    .catch((error) => {
      samplePhoto = undefined
      throw error
    })
  return samplePhoto
}

/**
 * Live preview for the watermark settings: the sample photo with the logo
 * applied (or without a watermark when there is no logo yet). WebP.
 */
export async function renderWatermarkPreview(settings: WatermarkLayout, logo?: Buffer | null): Promise<Buffer> {
  const photo = await getSamplePhoto()
  const image = logo ? await applyWatermark(photo, settings, logo) : (await loadSharp())(photo.data, { raw: photo.info })
  return image.webp({ quality: 80 }).toBuffer()
}
