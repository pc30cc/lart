"use server"

import { and, count, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db, type Tx } from "@/db"
import { auditLog, instructorDocuments } from "@/db/schema"
import { adminAction, instructorAction, UserError } from "@/lib/action"
import { errorForLog } from "@/lib/errors"
import { remove } from "@/lib/storage"
import { isSafePath, mediaContentType } from "@/lib/storage/shared"
import { addDocumentSchema, documentIdSchema, editDocumentSchema, MAX_DOCUMENTS } from "./schema"

const revalidate = () => {
  revalidatePath("/[locale]/instructor", "layout")
  revalidatePath("/[locale]/workshops/[slug]/instructor", "page")
  revalidatePath("/[locale]/admin/instructors/[id]", "page")
}

/** The files of deleted documents go after the database change (a failure only leaves an unused file). */
async function removeFiles(paths: (string | null)[]) {
  for (const path of paths) {
    if (path) await remove(path).catch((err) => console.error("[instructor-documents] could not remove a file", errorForLog(err)))
  }
}

/**
 * The upload of `path` by this instructor (`/api/instructor/uploads` audits
 * each one with their id): its public copy, or null when they did not upload it.
 */
async function upload(tx: Tx, path: string, instructorId: string): Promise<{ thumbPath: string | null } | null> {
  const [row] = await tx
    .select({ data: auditLog.data })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "media.upload"),
        eq(auditLog.entity, "media"),
        eq(auditLog.entityId, path),
        sql`${auditLog.data} ->> 'by' = 'instructor'`,
        sql`${auditLog.data} ->> 'instructorId' = ${instructorId}`,
        sql`${auditLog.data} ->> 'purpose' = 'instructor_document'`,
      ),
    )
    .limit(1)
  if (!row) return null
  const thumb = (row.data as { thumbPath?: unknown } | null)?.thumbPath
  return { thumbPath: isSafePath(thumb) ? thumb : null }
}

/**
 * Add a certificate or licence to my profile: a file I uploaded (photo or
 * PDF) with its title, who gave it, the year and a description. At most
 * MAX_DOCUMENTS. Audited as `instructor.document_add`.
 */
export const addDocumentAction = instructorAction(addDocumentSchema, async (input, ctx) => {
  const instructorId = ctx.instructor.id
  const id = await db.transaction(async (tx) => {
    // One at a time per instructor, so the limit holds.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`instructor-documents:${instructorId}`}))`)
    const file = await upload(tx, input.path, instructorId)
    if (!file) throw new UserError("instructorPanel.documents.errors.file", { field: "path" })
    const [{ n }] = await tx.select({ n: count() }).from(instructorDocuments).where(eq(instructorDocuments.instructorId, instructorId))
    if (n >= MAX_DOCUMENTS) throw new UserError("instructorPanel.documents.errors.tooMany")
    const [{ n: used }] = await tx.select({ n: count() }).from(instructorDocuments).where(eq(instructorDocuments.path, input.path))
    if (used) throw new UserError("instructorPanel.documents.errors.file", { field: "path" })
    const [row] = await tx
      .insert(instructorDocuments)
      .values({
        instructorId,
        path: input.path,
        thumbPath: file.thumbPath,
        contentType: mediaContentType(input.path) ?? "application/octet-stream",
        title: input.title,
        issuer: input.issuer,
        year: input.year,
        description: input.description,
        sort: n,
      })
      .returning({ id: instructorDocuments.id })
    await ctx.audit({ action: "instructor.document_add", entity: "instructor", entityId: instructorId, data: { documentId: row.id, title: input.title } }, tx)
    return row.id
  })
  revalidate()
  return { id }
})

/** Change a document's details (not its file: a new file is a new document). */
export const editDocumentAction = instructorAction(editDocumentSchema, async (input, ctx) => {
  const instructorId = ctx.instructor.id
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(instructorDocuments)
      .set({ title: input.title, issuer: input.issuer, year: input.year, description: input.description })
      .where(and(eq(instructorDocuments.id, input.id), eq(instructorDocuments.instructorId, instructorId)))
      .returning({ id: instructorDocuments.id })
    if (!row) throw new UserError("common.errors.notFound")
    await ctx.audit({ action: "instructor.document_edit", entity: "instructor", entityId: instructorId, data: { documentId: row.id, title: input.title } }, tx)
  })
  revalidate()
  return { saved: true }
})

/** Remove one of my documents, and its files. */
export const deleteDocumentAction = instructorAction(documentIdSchema, async (input, ctx) => {
  const instructorId = ctx.instructor.id
  const files = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(instructorDocuments)
      .where(and(eq(instructorDocuments.id, input.id), eq(instructorDocuments.instructorId, instructorId)))
      .returning({ path: instructorDocuments.path, thumbPath: instructorDocuments.thumbPath, title: instructorDocuments.title })
    if (!row) throw new UserError("common.errors.notFound")
    await ctx.audit({ action: "instructor.document_delete", entity: "instructor", entityId: instructorId, data: { documentId: input.id, title: row.title } }, tx)
    return [row.path, row.thumbPath]
  })
  await removeFiles(files)
  revalidate()
  return { deleted: true }
})

/**
 * A super admin removes an instructor's document (one that should not be on
 * their public profile). Audited as `instructor.document_delete`.
 */
export const adminDeleteDocumentAction = adminAction(documentIdSchema, async (input, ctx) => {
  const files = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(instructorDocuments)
      .where(eq(instructorDocuments.id, input.id))
      .returning({ instructorId: instructorDocuments.instructorId, path: instructorDocuments.path, thumbPath: instructorDocuments.thumbPath, title: instructorDocuments.title })
    if (!row) throw new UserError("common.errors.notFound")
    await ctx.audit({ action: "instructor.document_delete", entity: "instructor", entityId: row.instructorId, data: { documentId: input.id, title: row.title } }, tx)
    return [row.path, row.thumbPath]
  })
  await removeFiles(files)
  revalidate()
  return { deleted: true }
})
