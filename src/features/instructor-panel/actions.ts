"use server"

import { and, eq, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import { db, type Tx } from "@/db"
import { auditLog, contracts, courses, instructors, type LocalizedText } from "@/db/schema"
import { renderContract } from "@/features/contracts/render"
import { signContract } from "@/features/contracts/sign"
import { instructorAction, UserError } from "@/lib/action"
import { audit, changes } from "@/lib/audit"
import { clientIp } from "@/lib/auth/request"
import { sha256 } from "@/lib/crypto"
import { errorForLog } from "@/lib/errors"
import { remove } from "@/lib/storage"
import { normalizeName, profileSchema, sameName, signSchema } from "./schema"

const revalidatePanel = () => revalidatePath("/[locale]/instructor", "layout")

/**
 * Sign one of my contracts. The name typed must be the official name (spacing
 * and letter case aside), and the text on the page must still be the text that
 * gets signed: if the contract changed since the page was opened, nothing is
 * signed and the instructor is asked to read it again. `signContract` checks
 * again, under lock, that the contract is theirs and still waiting, stores the
 * text with the evidence (time, IP, browser) and publishes the workshop.
 */
export const signContractAction = instructorAction(signSchema, async (input, ctx) => {
  const [row] = await db
    .select({ status: contracts.status, courseStatus: courses.status, officialName: instructors.officialName })
    .from(contracts)
    .innerJoin(courses, eq(courses.id, contracts.courseId))
    .innerJoin(instructors, eq(instructors.id, contracts.instructorId))
    .where(and(eq(contracts.id, input.contractId), eq(contracts.instructorId, ctx.instructor.id)))
    .limit(1)
  if (!row) throw new UserError("contracts.errors.notFound")
  if (row.status === "signed") throw new UserError("contracts.errors.alreadySigned")
  if (row.status === "void") throw new UserError("contracts.errors.replaced")
  if (row.courseStatus !== "awaiting_signature") throw new UserError("contracts.errors.notSignable")
  if (!sameName(input.signedName, row.officialName)) {
    throw new UserError("instructorPanel.sign.errors.nameMismatch", {
      field: "signedName",
      values: { name: row.officialName },
    })
  }
  if (sha256(await renderContract(input.contractId, input.locale)) !== input.textSha256) {
    throw new UserError("instructorPanel.sign.errors.textChanged")
  }

  const request = await headers()
  const result = await signContract(
    input.contractId,
    ctx.instructor.id,
    normalizeName(input.signedName),
    clientIp(request),
    request.get("user-agent"),
    input.locale,
  )
  const [course] = await db.select({ status: courses.status }).from(courses).where(eq(courses.id, result.courseId))
  revalidatePanel()
  return { workshopStatus: course?.status ?? "published" }
})

/**
 * Save my public profile (names, teaching field, introduction, languages,
 * website, photo). Private fields are never touched here. A new photo must be
 * one this instructor uploaded (`/api/instructor/uploads` audits each upload
 * with their id); the old photo is removed after the save. Audited as
 * `instructor.profile_update` (no admin; `by: "instructor"`).
 */
export const updateProfileAction = instructorAction(profileSchema, async (input, ctx) => {
  const id = ctx.instructor.id
  const after = { ...input, bio: emptyToNull(input.bio) }

  const oldPhoto = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        displayName: instructors.displayName,
        teachingField: instructors.teachingField,
        bio: instructors.bio,
        teachingLanguages: instructors.teachingLanguages,
        website: instructors.website,
        photoPath: instructors.photoPath,
      })
      .from(instructors)
      .where(eq(instructors.id, id))
      .for("update")
    if (!before) throw new UserError("common.errors.notFound")
    if (after.photoPath && after.photoPath !== before.photoPath && !(await uploadedBy(tx, after.photoPath, id))) {
      throw new UserError("instructors.errors.photo", { field: "photoPath" })
    }

    const diff = changes(before, after)
    if (!Object.keys(diff).length) return null
    await tx
      .update(instructors)
      .set({ ...after, updatedAt: sql`now()` })
      .where(eq(instructors.id, id))
    await audit(
      { adminId: null, action: "instructor.profile_update", entity: "instructor", entityId: id, data: { by: "instructor", ...diff } },
      tx,
    )
    return before.photoPath !== after.photoPath ? before.photoPath : null
  })

  if (oldPhoto) {
    await remove(oldPhoto).catch((err) => console.error("[instructor-panel] could not remove the old photo", errorForLog(err)))
  }
  revalidatePanel()
  return { saved: true }
})

const emptyToNull = (text: LocalizedText) => (Object.keys(text).length ? text : null)

/** Whether this instructor uploaded the file (the upload route's audit entry says so). */
async function uploadedBy(tx: Tx, path: string, instructorId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "media.upload"),
        eq(auditLog.entity, "media"),
        eq(auditLog.entityId, path),
        isNull(auditLog.adminId),
        sql`${auditLog.data} ->> 'instructorId' = ${instructorId}`,
      ),
    )
    .limit(1)
  return Boolean(row)
}
