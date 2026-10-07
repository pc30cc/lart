import { z } from "zod"

import { audit } from "@/lib/audit"
import { requireInstructorApi } from "@/lib/auth/instructor"
import { createRateLimiter } from "@/lib/auth/rate-limit"
import { errorForLog } from "@/lib/errors"
import { getSetting } from "@/lib/settings"
import { getStorage, StorageError } from "@/lib/storage"
import { MultipartReader, multipartBoundary } from "@/lib/storage/multipart"
import { folderName, MAX_IMAGE_BYTES, UploadError, uploadErrorStatus, type UploadErrorCode } from "@/lib/storage/shared"
import { storeImage } from "@/lib/storage/upload"

/** Room for the multipart framing around the file. */
const FRAMING_BYTES = 16 * 1024
/** Instructors upload one thing: their profile photo. */
const fieldsSchema = z.strictObject({ purpose: z.literal("instructor_photo") })
/** Plenty for choosing a photo, too few to fill the storage. */
const uploads = createRateLimiter({ limit: 20, windowMs: 60 * 60_000 })

const fail = (code: UploadErrorCode) => Response.json({ error: code }, { status: uploadErrorStatus[code] })

/**
 * The instructor's profile photo upload (the instructor panel's profile page):
 * multipart/form-data with "purpose" ("instructor_photo", the only one) first,
 * then "file". Same checks and processing as the admin upload route (type from
 * the bytes, size and pixel limits, re-encoded square WebP, no metadata),
 * stored under instructors/<the instructor's English or Turkish name>/.
 * Answers UploadResult (201) or { error }. Each upload is audited with the
 * instructor's id, which is how saving the profile knows the photo is theirs
 * (`by: "instructor"`; while a super admin views as them, that admin is the
 * entry's admin, with `impersonatedBy`).
 */
export async function POST(request: Request) {
  const session = await requireInstructorApi(request)
  if (!session) return fail("unauthorized")
  const instructorId = session.instructor.id
  const viewer = session.impersonatedBy ?? null
  if (!uploads.consume(instructorId).ok) return Response.json({ error: "rate_limited" }, { status: 429 })

  const boundary = multipartBoundary(request.headers.get("content-type"))
  if (!boundary || !request.body) return fail("bad_request")
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_IMAGE_BYTES + FRAMING_BYTES) return fail("too_large")

  const form = new MultipartReader(request.body, boundary)
  try {
    const part = await form.next()
    if (part?.name !== "purpose" || part.filename !== null) return fail("bad_request")
    const fields = fieldsSchema.safeParse({ purpose: (await form.text(64)).trim() })
    const file = await form.next()
    if (!fields.success || file?.name !== "file" || file.filename === null) return fail("bad_request")

    const [storage, watermark] = await Promise.all([getStorage(), getSetting("watermark")])
    const { displayName } = session.instructor
    const result = await storeImage({
      storage,
      purpose: "instructor_photo",
      file: form.file(MAX_IMAGE_BYTES),
      watermark,
      folder: folderName([displayName.en, displayName.tr]),
    })
    const { path, width, height } = result
    try {
      await audit({
        adminId: viewer?.id ?? null,
        action: "media.upload",
        entity: "media",
        entityId: path,
        data: {
          purpose: "instructor_photo",
          width,
          height,
          by: "instructor",
          instructorId,
          ...(viewer ? { impersonatedBy: viewer.id } : {}),
        },
      })
    } catch (error) {
      // No unaudited files: undo the upload.
      await storage.remove(path).catch(() => {})
      throw error
    }
    return Response.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof UploadError) return fail(error.code)
    console.error("[instructor uploads]", errorForLog(error))
    return fail(error instanceof StorageError ? "storage" : "server")
  } finally {
    await form.cancel()
  }
}
