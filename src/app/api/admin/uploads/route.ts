import { z } from "zod"

import { audit } from "@/lib/audit"
import { requireAdminApi } from "@/lib/auth/admin"
import { errorForLog } from "@/lib/errors"
import { getSetting } from "@/lib/settings"
import { getStorage, StorageError } from "@/lib/storage"
import { MultipartReader, multipartBoundary } from "@/lib/storage/multipart"
import {
  isImagePurpose,
  isPrivatePurpose,
  MAX_VIDEO_BYTES,
  maxUploadBytes,
  UploadError,
  uploadErrorStatus,
  uploadPurposes,
  type UploadErrorCode,
  type UploadResult,
} from "@/lib/storage/shared"
import { PartMismatch, storeImage, storeVideoPart } from "@/lib/storage/upload"

/** Room for the multipart framing around the file. */
const FRAMING_BYTES = 16 * 1024
const bytes = z.string().regex(/^\d{1,10}$/).transform(Number)
const fieldsSchema = z.strictObject({
  purpose: z.enum(uploadPurposes),
  // Videos only, sent in parts (see storeVideoPart).
  total: bytes.optional(),
  upload: z.string().min(1).max(64).optional(),
  offset: bytes.optional(),
})

const fail = (code: UploadErrorCode) => Response.json({ error: code }, { status: uploadErrorStatus[code] })

/**
 * Upload a file: multipart/form-data with short text fields first ("purpose",
 * and for video parts "total", "upload", "offset"), then "file".
 * Answers UploadResult (201), a video part receipt { upload, received } (202,
 * or 409 when the offset is behind), or { error: UploadErrorCode }.
 */
export async function POST(request: Request) {
  const session = await requireAdminApi(request)
  if (!session) return fail("unauthorized")

  const boundary = multipartBoundary(request.headers.get("content-type"))
  if (!boundary || !request.body) return fail("bad_request")
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_VIDEO_BYTES + FRAMING_BYTES) return fail("too_large")

  const form = new MultipartReader(request.body, boundary)
  try {
    const raw = new Map<string, string>()
    let part = await form.next()
    while (part && part.filename === null && raw.size < 4 && !raw.has(part.name)) {
      raw.set(part.name, (await form.text(64)).trim())
      part = await form.next()
    }
    const fields = fieldsSchema.safeParse(Object.fromEntries(raw))
    if (part?.name !== "file" || part.filename === null || !fields.success) return fail("bad_request")
    const { purpose, total, upload, offset } = fields.data
    if (isImagePurpose(purpose)) {
      if (total !== undefined || upload !== undefined || offset !== undefined) return fail("bad_request")
      if (declared > maxUploadBytes(purpose) + FRAMING_BYTES) return fail("too_large")
    }

    const [storage, watermark] = await Promise.all([getStorage(), getSetting("watermark")])
    let result: UploadResult
    if (isImagePurpose(purpose)) {
      result = await storeImage({ storage, purpose, file: form.file(maxUploadBytes(purpose)), watermark })
    } else {
      const limit = (total ?? MAX_VIDEO_BYTES) - (offset ?? 0)
      const stored = await storeVideoPart({
        storage,
        owner: session.admin.id,
        file: form.file(Math.max(0, limit)),
        upload,
        offset,
        total,
      })
      if (!("path" in stored)) return Response.json(stored, { status: 202 })
      result = stored
    }

    const { path, originalPath, width, height } = result
    try {
      await audit({
        adminId: session.admin.id,
        action: "media.upload",
        entity: "media",
        entityId: path,
        data: { purpose, originalPath, width, height },
      })
    } catch (error) {
      // No unaudited files: undo the upload.
      await Promise.allSettled([
        storage.remove(path, isPrivatePurpose(purpose) ? "private" : "public"),
        originalPath && storage.remove(originalPath, "private"),
      ])
      throw error
    }
    return Response.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof UploadError && error.code === "bad_request" && declared > 10 * 1024 * 1024) {
      console.warn("[uploads] body ended early: is src/proxy.ts running on /api/admin/uploads? It buffers only 10 MB.")
    }
    if (error instanceof UploadError) return fail(error.code)
    if (error instanceof PartMismatch) return Response.json(error.received, { status: 409 })
    console.error("[uploads]", errorForLog(error))
    return fail(error instanceof StorageError ? "storage" : "server")
  } finally {
    await form.cancel()
  }
}
