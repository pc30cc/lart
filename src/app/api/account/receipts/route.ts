import { z } from "zod"

import { requireMemberApi } from "@/lib/auth/member"
import { createRateLimiter } from "@/lib/auth/rate-limit"
import { errorForLog } from "@/lib/errors"
import { attachReceipt, canAttachReceipt } from "@/features/registrations/receipt"
import { getSetting } from "@/lib/settings"
import { getStorage, StorageError } from "@/lib/storage"
import { MultipartReader, multipartBoundary } from "@/lib/storage/multipart"
import { MAX_IMAGE_BYTES, UploadError, uploadErrorStatus, type UploadErrorCode } from "@/lib/storage/shared"
import { storeImage } from "@/lib/storage/upload"

/** Room for the multipart framing around the file. */
const FRAMING_BYTES = 16 * 1024
/** Enough to send a receipt again a few times, too few to fill the storage. */
const uploads = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 })

const fail = (code: UploadErrorCode) => Response.json({ error: code }, { status: uploadErrorStatus[code] })
/** Not theirs, paid or cancelled: nothing to send a receipt for. */
const notFound = () => Response.json({ error: "not_found" }, { status: 404 })

/**
 * A member sends the bank transfer receipt of one of their registrations
 * (its page, "Send the receipt"): multipart/form-data with "registrationId"
 * first, then "file" (a photo, kept as WebP without metadata, or a PDF kept as
 * it is), stored in receipts/ like the expense receipts. Only for their own
 * registration that is still waiting for payment; never while a super admin
 * views as them. Answers { ok: true } (201) or { error }.
 */
export async function POST(request: Request) {
  const session = await requireMemberApi(request)
  if (!session) return fail("unauthorized")
  if (session.impersonatedBy) return Response.json({ error: "impersonating" }, { status: 403 })
  const memberId = session.member.id
  if (!uploads.consume(memberId).ok) return Response.json({ error: "rate_limited" }, { status: 429 })

  const boundary = multipartBoundary(request.headers.get("content-type"))
  if (!boundary || !request.body) return fail("bad_request")
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_IMAGE_BYTES + FRAMING_BYTES) return fail("too_large")

  const form = new MultipartReader(request.body, boundary)
  try {
    const part = await form.next()
    if (part?.name !== "registrationId" || part.filename !== null) return fail("bad_request")
    const id = z.uuid().safeParse((await form.text(64)).trim())
    if (!id.success || !(await canAttachReceipt(memberId, id.data))) return notFound()
    const file = await form.next()
    if (file?.name !== "file" || file.filename === null) return fail("bad_request")

    const [storage, watermark] = await Promise.all([getStorage(), getSetting("watermark")])
    const { path } = await storeImage({ storage, purpose: "receipt", file: form.file(MAX_IMAGE_BYTES), watermark })
    let attached: Awaited<ReturnType<typeof attachReceipt>>
    try {
      attached = await attachReceipt(memberId, id.data, path)
    } catch (error) {
      await storage.remove(path).catch(() => {})
      throw error
    }
    if (!attached) {
      // Paid or cancelled meanwhile: nothing kept.
      await storage.remove(path).catch(() => {})
      return notFound()
    }
    if (attached.previous) await storage.remove(attached.previous).catch(() => {})
    return Response.json({ ok: true }, { status: 201 })
  } catch (error) {
    if (error instanceof UploadError) return fail(error.code)
    console.error("[account receipts]", errorForLog(error))
    return fail(error instanceof StorageError ? "storage" : "server")
  } finally {
    await form.cancel()
  }
}
