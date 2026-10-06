import "server-only"
import { randomBytes } from "node:crypto"
import { createWriteStream, openAsBlob } from "node:fs"
import { open, readdir, rm, stat, truncate } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import { processImage, processOriginal, type WatermarkSettings } from "@/lib/images"
import { newObjectPath, type Storage } from "./index"
import {
  MAX_VIDEO_BYTES,
  privateUrl,
  UploadError,
  type ImagePurpose,
  type UploadResult,
  type VideoPartReceived,
} from "./shared"
import { SNIFF_BYTES, sniffVideo, videoContentType } from "./sniff"

const prefixes: Record<ImagePurpose, string> = {
  instructor_photo: "instructors",
  course_cover: "courses",
  course_sample: "courses",
  gallery_photo: "gallery",
  watermark_logo: "brand",
}

/**
 * Check, process and store one uploaded image (the byte limit is enforced by
 * the stream). Images are re-encoded; gallery photos keep a private
 * unwatermarked original; the watermark logo is private.
 */
export async function storeImage({
  storage,
  purpose,
  file,
  watermark,
}: {
  storage: Storage
  purpose: ImagePurpose
  file: ReadableStream<Uint8Array>
  watermark: WatermarkSettings
}): Promise<UploadResult> {
  const input = Buffer.from(await new Response(file).arrayBuffer())
  if (purpose === "gallery_photo") return storeGalleryPhoto(storage, input, watermark)

  const image = await processImage(input, purpose)
  const path = newObjectPath(prefixes[purpose], image.ext)
  const size = { width: image.width, height: image.height }
  if (purpose === "watermark_logo") {
    await storage.putPrivate(path, image.data, image.contentType)
    return { path, url: privateUrl(path), ...size }
  }
  await storage.putPublic(path, image.data, image.contentType)
  return { path, url: storage.publicUrl(path), ...size }
}

async function storeGalleryPhoto(storage: Storage, input: Buffer, settings: WatermarkSettings): Promise<UploadResult> {
  // Without a logo yet the photo goes up unwatermarked and the answer says so.
  const logo = settings.enabled && settings.logoPath ? await readLogo(storage, settings.logoPath) : null
  const original = await processOriginal(input)
  const photo = await processImage(input, "gallery_photo", logo && { settings, logo })

  const originalPath = newObjectPath("originals", original.ext)
  const path = newObjectPath(prefixes.gallery_photo, photo.ext)
  await storage.putPrivate(originalPath, original.data, original.contentType)
  try {
    await storage.putPublic(path, photo.data, photo.contentType)
  } catch (error) {
    await storage.remove(originalPath, "private").catch(() => {})
    throw error
  }
  return {
    path,
    url: storage.publicUrl(path),
    width: photo.width,
    height: photo.height,
    originalPath,
    watermarked: !!logo,
  }
}

async function readLogo(storage: Storage, logoPath: string): Promise<Buffer> {
  const file = await storage.readPrivate(logoPath).catch(() => null)
  if (!file) throw new UploadError("watermark_unavailable")
  return Buffer.from(await new Response(file.body).arrayBuffer())
}

// ─── Videos ────────────────────────────────────────────────────────────────

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
 * the CDN. Nothing reaches the CDN unless the whole video arrived.
 *
 * - No `upload`: a new upload; `total` is the full size (absent: this request is the whole file).
 * - With `upload` and `offset`: the next part of that upload.
 * Answers the stored video, or how much of it has arrived so far.
 */
export async function storeVideoPart({
  storage,
  owner,
  file,
  upload,
  offset = 0,
  total,
}: {
  storage: Storage
  /** The admin id: an upload can only be continued by the admin who started it. */
  owner: string
  file: ReadableStream<Uint8Array>
  upload?: string
  offset?: number
  total?: number
}): Promise<UploadResult | VideoPartReceived> {
  if ((upload ? !UPLOAD_ID.test(upload) : offset !== 0) || !/^[\w-]{1,64}$/.test(owner)) throw new UploadError("bad_request")
  if (total !== undefined && (total < 1 || offset >= total)) throw new UploadError("bad_request")
  if ((total ?? 0) > MAX_VIDEO_BYTES) throw new UploadError("too_large")

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
    if (head && !sniffVideo(head)) {
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
      if (!type) throw new UploadError("unsupported_type")
      const contentType = videoContentType[type]
      const storagePath = newObjectPath("gallery", type)
      await storage.putPublic(storagePath, await openAsBlob(temp, { type: contentType }), contentType)
      return { path: storagePath, url: storage.publicUrl(storagePath) }
    } finally {
      await rm(temp, { force: true })
    }
  } finally {
    busy.delete(temp)
  }
}
