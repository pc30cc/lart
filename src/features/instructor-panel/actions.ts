"use server"

import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import { db, type Tx } from "@/db"
import { auditLog, contracts, courses, instructors, type LocalizedText } from "@/db/schema"
import { signContract } from "@/features/contracts/sign"
import { instructorAction, UserError } from "@/lib/action"
import { changes } from "@/lib/audit"
import { clientIp } from "@/lib/auth/request"
import { errorForLog } from "@/lib/errors"
import { remove } from "@/lib/storage"
import { normalizeName, profileSchema, sameName, signSchema } from "./schema"

const revalidatePanel = () => revalidatePath("/[locale]/instructor", "layout")

/**
 * Sign one of my contracts. The name typed must be the official name (spacing
 * and letter case aside), and the text on the page must still be the text that
 * gets signed: the form sends the fingerprint (SHA-256) of the text the
 * instructor read, and `signContract` compares it, under lock, with the text it
 * signs; if the contract changed since the page was opened, nothing is signed
 * and the instructor is asked to read it again. `signContract` also checks
 * again that the contract is theirs and still waiting, stores the text with
 * the evidence (time, IP, browser) and publishes the workshop. An e-signature
 * is the instructor's own: refused while a super admin views as them.
 */
export const signContractAction = instructorAction(
  signSchema,
  async (input, ctx) => {
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
    const request = await headers()
    const result = await signContract(
      input.contractId,
      ctx.instructor.id,
      normalizeName(input.signedName),
      clientIp(request),
      request.get("user-agent"),
      input.locale,
      input.textSha256,
    )
    const [course] = await db.select({ status: courses.status }).from(courses).where(eq(courses.id, result.courseId))
    revalidatePanel()
    return { workshopStatus: course?.status ?? "published" }
  },
  { notImpersonated: true },
)

/**
 * Save my public profile (names, teaching field, introduction, languages,
 * website, photo). Private fields are never touched here. A new photo must be
 * one this instructor uploaded (`/api/instructor/uploads` audits each upload
 * with their id); the old photo is removed after the save. Audited as
 * `instructor.profile_update` through `ctx.audit` (`by: "instructor"`; while a
 * super admin views as them, that admin with `impersonatedBy`).
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
    await ctx.audit({ action: "instructor.profile_update", entity: "instructor", entityId: id, data: diff }, tx)
    return before.photoPath !== after.photoPath ? before.photoPath : null
  })

  if (oldPhoto) {
    await remove(oldPhoto).catch((err) => console.error("[instructor-panel] could not remove the old photo", errorForLog(err)))
  }
  revalidatePanel()
  return { saved: true }
})

const emptyToNull = (text: LocalizedText) => (Object.keys(text).length ? text : null)

/**
 * Whether this instructor uploaded the file (the upload route's audit entry
 * says so: `by: "instructor"`, also when a super admin viewing as them did it;
 * the admin upload route never writes `by`).
 */
async function uploadedBy(tx: Tx, path: string, instructorId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "media.upload"),
        eq(auditLog.entity, "media"),
        eq(auditLog.entityId, path),
        sql`${auditLog.data} ->> 'by' = 'instructor'`,
        sql`${auditLog.data} ->> 'instructorId' = ${instructorId}`,
      ),
    )
    .limit(1)
  return Boolean(row)
}
