import { eq } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db"
import { courses, instructors } from "@/db/schema"
import { audit } from "@/lib/audit"
import { requireAdminApi, type AdminSession } from "@/lib/auth/admin"
import { errorForLog } from "@/lib/errors"
import { getSetting } from "@/lib/settings"
import { getStorage, StorageError } from "@/lib/storage"
import { MultipartReader, multipartBoundary } from "@/lib/storage/multipart"
import {
  folderName,
  isImagePurpose,
  MAX_VIDEO_BYTES,
  maxUploadBytes,
  UploadError,
  uploadErrorStatus,
  uploadPurposes,
  type UploadErrorCode,
  type UploadPurpose,
  type UploadResult,
} from "@/lib/storage/shared"
import { PartMismatch, storeImage, storeVideoPart } from "@/lib/storage/upload"

/** Room for the multipart framing around the file. */
const FRAMING_BYTES = 16 * 1024
const bytes = z.string().regex(/^\d{1,10}$/).transform(Number)
const fieldsSchema = z.strictObject({
  purpose: z.enum(uploadPurposes),
  // Whose folder the file goes to (see folderOf).
  courseId: z.uuid().optional(),
  instructorId: z.uuid().optional(),
  folder: z.string().max(64).optional(),
  // Videos only, sent in parts (see storeVideoPart).
  total: bytes.optional(),
  upload: z.string().min(1).max(64).optional(),
  offset: bytes.optional(),
})
type Fields = z.output<typeof fieldsSchema>
const MAX_FIELDS = Object.keys(fieldsSchema.shape).length

const fail = (code: UploadErrorCode) => Response.json({ error: code }, { status: uploadErrorStatus[code] })

/**
 * The folder name of an upload (`uploadPath` in lib/storage/upload.ts). The
 * server takes it from the database whenever the record exists: the workshop's
 * slug (`courseId`: covers, sample and gallery photos, videos), the
 * instructor's English or Turkish name (`instructorId`), the signed-in
 * partner's name if it has Latin letters, else their email (their photo and portrait). For a workshop or instructor not
 * saved yet, the form's `folder` hint (its slug or name), only ever used as a
 * sanitized name, else "new". The home page's photos and video always go to
 * site/ (no name). Null: an unknown id, or a field the purpose does not take.
 */
async function folderOf(purpose: UploadPurpose, fields: Fields, admin: AdminSession["admin"]): Promise<string | null> {
  const { courseId, instructorId, folder } = fields
  if (purpose === "site_image" || purpose === "site_video") {
    return courseId || instructorId || folder !== undefined ? null : ""
  }
  if (purpose === "admin_photo" || purpose === "partner_portrait" || purpose === "watermark_logo") {
    if (courseId || instructorId || folder !== undefined) return null
    // The name only when it has Latin letters ("مینا 2" would give "2"), else the email's local part.
    const fromName = folderName([admin.name], "")
    return folderName([/[a-z]/.test(fromName) ? fromName : null, admin.email.split("@")[0]]) // the logo's folder is always brand/
  }
  if (purpose === "instructor_photo") {
    if (courseId) return null
    if (!instructorId) return folderName([folder], "new")
    const [row] = await db
      .select({ displayName: instructors.displayName })
      .from(instructors)
      .where(eq(instructors.id, instructorId))
      .limit(1)
    return row ? folderName([row.displayName.en, row.displayName.tr]) : null
  }
  if (instructorId) return null
  if (!courseId) return folderName([folder], "new")
  const [course] = await db.select({ slug: courses.slug }).from(courses).where(eq(courses.id, courseId)).limit(1)
  return course ? folderName([course.slug]) : null
}

/**
 * Upload a file: multipart/form-data with short text fields first ("purpose";
 * "courseId", "instructorId" or "folder" for its folder, see folderOf; for
 * video parts "total", "upload", "offset", each part with the same folder
 * fields), then "file".
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
    while (part && part.filename === null && raw.size < MAX_FIELDS && !raw.has(part.name)) {
      raw.set(part.name, (await form.text(64)).trim())
      part = await form.next()
    }
    const fields = fieldsSchema.safeParse(Object.fromEntries(raw))
    if (part?.name !== "file" || part.filename === null || !fields.success) return fail("bad_request")
    const { purpose, total, upload, offset } = fields.data
    if (isImagePurpose(purpose) && (total !== undefined || upload !== undefined || offset !== undefined)) return fail("bad_request")
    if (declared > maxUploadBytes(purpose) + FRAMING_BYTES) return fail("too_large")
    const folder = await folderOf(purpose, fields.data, session.admin)
    if (folder === null) return fail("bad_request")

    const [storage, watermark] = await Promise.all([getStorage(), getSetting("watermark")])
    let result: UploadResult
    if (isImagePurpose(purpose)) {
      result = await storeImage({ storage, purpose, file: form.file(maxUploadBytes(purpose)), watermark, folder })
    } else {
      const limit = (total ?? maxUploadBytes(purpose)) - (offset ?? 0)
      const stored = await storeVideoPart({
        storage,
        purpose,
        owner: session.admin.id,
        file: form.file(Math.max(0, limit)),
        upload,
        offset,
        total,
        folder,
      })
      if (!("path" in stored)) return Response.json(stored, { status: 202 })
      result = stored
    }

    const { path, width, height } = result
    try {
      await audit({
        adminId: session.admin.id,
        action: "media.upload",
        entity: "media",
        entityId: path,
        data: { purpose, width, height },
      })
    } catch (error) {
      // No unaudited files: undo the upload.
      await storage.remove(path).catch(() => {})
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
