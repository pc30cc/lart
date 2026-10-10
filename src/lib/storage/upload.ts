import "server-only"
import { randomBytes } from "node:crypto"
import { createWriteStream, openAsBlob } from "node:fs"
import { open, readdir, rm, stat, truncate } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import { processImage, type WatermarkSettings } from "@/lib/images"
import { newObjectPath, type Storage } from "./index"
import {
  folderName,
  maxUploadBytes,
  UploadError,
  videoFormats,
  type ImagePurpose,
  type UploadPurpose,
  type UploadResult,
  type VideoPartReceived,
  type VideoPurpose,
} from "./shared"
import { SNIFF_BYTES, sniffVideo, videoContentType, type VideoType } from "./sniff"

/** Each purpose's folder and file name prefix; `name` is the workshop's or person's folder name. */
const layouts: Record<UploadPurpose, (name: string) => [dir: string, prefix: string]> = {
  course_cover: (name) => [`workshops/${name}`, "cover-"],
  course_sample: (name) => [`workshops/${name}/samples`, ""],
  gallery_photo: (name) => [`workshops/${name}/gallery`, ""],
  gallery_video: (name) => [`workshops/${name}/videos`, ""],
  instructor_photo: (name) => [`instructors/${name}`, "photo-"],
  admin_photo: (name) => [`partners/${name}`, "photo-"],
  // The partner's public photo on the About page (never the panel's avatar).
  partner_portrait: (name) => [`partners/${name}`, "portrait-"],
  watermark_logo: () => ["brand", "watermark-logo-"],
  // The home page's photos and video (Settings → Home page).
  site_image: () => ["site", "img-"],
  site_video: () => ["site", "video-"],
  receipt: () => ["receipts", ""],
}

/**
 * A new random path in the purpose's folder, e.g. `workshops/<slug>/cover-<random>.webp`,
 * `partners/<name>/photo-<random>.webp` or `site/img-<random>.webp`. `folder` is
 * sanitized again here (the logo and the home page's files ignore it).
 */
export function uploadPath(purpose: UploadPurpose, folder: string | undefined, ext: string): string {
  const [dir, prefix] = layouts[purpose](folderName([folder]))
  return newObjectPath(dir, ext, prefix)
}

/**
 * Check, process and store one uploaded image (the byte limit is enforced by
 * the stream). Images are re-encoded. A gallery photo is stored only
 * watermarked (README §10): without a logo, or when it cannot be read,
 * nothing is stored, and the original is never stored.
 */
export async function storeImage({
  storage,
  purpose,
  file,
  watermark,
  folder,
}: {
  storage: Storage
  purpose: ImagePurpose
  file: ReadableStream<Uint8Array>
  watermark: WatermarkSettings
  /** The workshop's or person's folder name (`folderName`); not used by the watermark logo and the home page's photos. */
  folder?: string
}): Promise<UploadResult> {
  const input = Buffer.from(await new Response(file).arrayBuffer())
  // A receipt may be a PDF: kept as it is (a document, not a picture), recognised by its header.
  if (purpose === "receipt" && isPdf(input)) {
    const path = uploadPath(purpose, folder, "pdf")
    await storage.put(path, input, "application/pdf")
    return { path, url: storage.publicUrl(path) }
  }
  const mark = purpose === "gallery_photo" ? { settings: watermark, logo: await readLogo(storage, watermark.logoPath) } : null
  const image = await processImage(input, purpose, mark)
  const path = uploadPath(purpose, folder, image.ext)
  await storage.put(path, image.data, image.contentType)
  return { path, url: storage.publicUrl(path), width: image.width, height: image.height }
}

/** A PDF starts with "%PDF-" (a few bytes of junk before it are allowed by readers, not here). */
export const isPdf = (input: Buffer) => input.subarray(0, 5).toString("latin1") === "%PDF-"

async function readLogo(storage: Storage, logoPath: string | null): Promise<Buffer> {
  if (!logoPath) throw new UploadError("watermark_missing")
  const file = await storage.read(logoPath).catch(() => null)
  if (!file) throw new UploadError("watermark_unavailable")
  return Buffer.from(await new Response(file.body).arrayBuffer())
}

// ─── Videos ────────────────────────────────────────────────────────────────

/** A video of a format the purpose takes. */
const accepts = (purpose: VideoPurpose, type: VideoType | null): type is VideoType =>
  type !== null && videoFormats[purpose].includes(type)

const TEMP_PREFIX = "lart-video-"
const UPLOAD_ID = /^[A-Za-z0-9_-]{22}$/
const STALE_MS = 24 * 60 * 60 * 1000
/** Parts being written right now, so one upload is never appended to twice at once. */
const busy = new Set<string>()

/** The client's offset does not match what arrived; it continues from `received`. */
export class PartMismatch extends Error {
  constructor(readonly received: VideoPartReceived) {
    super("Upload offset mismatch")
  }
}

async function readHead(stream: ReadableStreamDefaultReader<Uint8Array>) {
  let head = Buffer.alloc(0)
  while (head.length < SNIFF_BYTES) {
    const { done, value } = await stream.read()
    if (done) break
    head = Buffer.concat([head, value])
  }
  return head
}

async function fileHead(file: string) {
  const handle = await open(file)
  try {
    const head = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0)
    return head.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Remove temporary parts of uploads abandoned more than a day ago. */
async function sweepStaleParts() {
  const dir = os.tmpdir()
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.startsWith(TEMP_PREFIX))
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name)
      const info = await stat(file).catch(() => null)
      if (info && Date.now() - info.mtimeMs > STALE_MS) await rm(file, { force: true })
    }),
  )
}

/**
 * Videos arrive in parts (each one a short request, so proxies and server
 * timeouts never cut a long upload) and are appended to a private temporary
 * file: memory stays small and the length becomes known. When the last part
 * is in, the type is checked from its magic bytes and the file is streamed to
 * the CDN. Nothing reaches the CDN unless the whole video arrived. The
 * purpose decides the size limit, the formats it takes (`videoFormats`: no
 * MOV for the home page) and the folder.
 *
 * - No `upload`: a new upload; `total` is the full size (absent: this request is the whole file).
 * - With `upload` and `offset`: the next part of that upload.
 * Answers the stored video, or how much of it has arrived so far.
 */
export async function storeVideoPart({
  storage,
  purpose,
  owner,
  file,
  upload,
  offset = 0,
  total,
  folder,
}: {
  storage: Storage
  purpose: VideoPurpose
  /** The admin id: an upload can only be continued by the admin who started it. */
  owner: string
  file: ReadableStream<Uint8Array>
  upload?: string
  offset?: number
  total?: number
  /** The workshop's folder name (`folderName`), used when the last part arrives; not used by the home page's video. */
  folder?: string
}): Promise<UploadResult | VideoPartReceived> {
  if ((upload ? !UPLOAD_ID.test(upload) : offset !== 0) || !/^[\w-]{1,64}$/.test(owner)) throw new UploadError("bad_request")
  if (total !== undefined && (total < 1 || offset >= total)) throw new UploadError("bad_request")
  if ((total ?? 0) > maxUploadBytes(purpose)) throw new UploadError("too_large")

  const id = upload ?? randomBytes(16).toString("base64url")
  const temp = path.join(os.tmpdir(), `${TEMP_PREFIX}${owner}-${id}`)
  if (busy.has(temp)) throw new UploadError("bad_request")
  busy.add(temp)
  try {
    const reader = file.getReader()
    if (upload) {
      const received = (await stat(temp).catch(() => null))?.size
      if (received === undefined) throw new UploadError("bad_request")
      if (received !== offset) {
        await reader.cancel().catch(() => {})
        throw new PartMismatch({ upload: id, received })
      }
    } else {
      sweepStaleParts().catch(() => {})
    }

    // Look at the first bytes before storing anything.
    const head = offset === 0 ? await readHead(reader) : null
    if (head && !accepts(purpose, sniffVideo(head))) {
      await reader.cancel().catch(() => {})
      throw new UploadError("unsupported_type")
    }
    try {
      await pipeline(async function* () {
        if (head) yield head
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          yield value
        }
      }, createWriteStream(temp, { flags: upload ? "a" : "wx", mode: 0o600 }))
    } catch (error) {
      // Drop the half-written part so the same part can simply be sent again.
      await (upload ? truncate(temp, offset) : rm(temp, { force: true })).catch(() => {})
      throw error
    }

    const received = (await stat(temp)).size
    if (total !== undefined && received < total) return { upload: id, received }
    try {
      if (total !== undefined && received !== total) throw new UploadError("bad_request")
      const type = sniffVideo(await fileHead(temp))
      if (!accepts(purpose, type)) throw new UploadError("unsupported_type")
      const contentType = videoContentType[type]
      const storagePath = uploadPath(purpose, folder, type)
      await storage.put(storagePath, await openAsBlob(temp, { type: contentType }), contentType)
      return { path: storagePath, url: storage.publicUrl(storagePath) }
    } finally {
      await rm(temp, { force: true })
    }
  } finally {
    busy.delete(temp)
  }
}
