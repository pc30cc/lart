"use server"

import { and, count, eq, isNull, ne, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getLocale } from "next-intl/server"

import { db, type Tx } from "@/db"
import { contracts, courses, emailTokens, instructors, sessions, type LocalizedText } from "@/db/schema"
import { adminAction, UserError } from "@/lib/action"
import { changes } from "@/lib/audit"
import { decrypt, encrypt, randomToken, sha256 } from "@/lib/crypto"
import { sendEmail } from "@/lib/email"
import { env } from "@/lib/env"
import { PG, pgError } from "@/lib/errors"
import { remove } from "@/lib/storage"
import {
  instructorActiveSchema,
  instructorIdSchema,
  instructorSchema,
  instructorUpdateSchema,
  INVITE_TTL_MS,
  inviteLocales,
  profileText,
  resendInviteSchema,
  type InviteLocale,
} from "./schema"

/** Turn database constraint errors into friendly messages. */
function friendly(err: unknown): never {
  const pg = pgError(err)
  if (pg?.code === PG.uniqueViolation && pg.constraint === "instructors_email_unique") {
    throw new UserError("instructors.errors.emailTaken", { field: "email" })
  }
  if (pg?.code === PG.foreignKeyViolation) throw new UserError("instructors.errors.inUse")
  throw err
}

function revalidate() {
  revalidatePath("/[locale]/admin/instructors", "page")
  revalidatePath("/[locale]/admin/instructors/[id]", "page")
}

const notFound = () => new UserError("instructors.errors.notFound")
const ofInstructor = (id: string) => and(eq(emailTokens.kind, "instructor"), eq(emailTokens.subjectId, id))
const emptyToNull = (text: LocalizedText) => (Object.keys(text).length ? text : null)

/** Emails are unique regardless of case (they are stored lower-case; this also covers older rows). */
async function assertEmailFree(tx: Tx, email: string, exceptId?: string) {
  const [taken] = await tx
    .select({ id: instructors.id })
    .from(instructors)
    .where(and(sql`lower(${instructors.email}) = ${email}`, exceptId ? ne(instructors.id, exceptId) : undefined))
    .limit(1)
  if (taken) throw new UserError("instructors.errors.emailTaken", { field: "email" })
}

/**
 * A new one-time invitation token. Only its SHA-256 is stored; earlier unused
 * invitations stop working, so only the newest link opens the account.
 */
async function issueInvite(tx: Tx, instructorId: string): Promise<string> {
  await tx
    .delete(emailTokens)
    .where(and(ofInstructor(instructorId), eq(emailTokens.purpose, "invite"), isNull(emailTokens.usedAt)))
  const token = randomToken()
  await tx.insert(emailTokens).values({
    id: sha256(token),
    purpose: "invite",
    kind: "instructor",
    subjectId: instructorId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  })
  return token
}

/** Email the invitation link. Returns false when the email could not be sent (already logged). */
async function sendInvite(to: string, displayName: LocalizedText, locale: InviteLocale, token: string) {
  const acceptUrl = new URL(`/${locale}/instructor/accept-invite?token=${encodeURIComponent(token)}`, env.APP_URL).href
  const result = await sendEmail({
    to,
    template: "instructor_invite",
    locale,
    props: { name: profileText(displayName, locale), acceptUrl },
  })
  return result.ok
}

async function removePhoto(path: string) {
  try {
    await remove(path)
  } catch (err) {
    console.error("[instructors] could not remove the old photo", path, err)
  }
}

/** Public fields, as written to the audit log (private ones are only named, never copied). */
const PUBLIC_FIELDS = ["displayName", "teachingField", "bio", "teachingLanguages", "website", "photoPath"] as const
const PRIVATE_FIELDS = ["officialName", "mobile", "email"] as const
const pick = <T extends Record<string, unknown>, K extends keyof T>(row: T, keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, row[k]])) as Pick<T, K>

/** Create an instructor and email them an invitation to choose a password. */
export const createInstructor = adminAction(instructorSchema, async ({ idNumber, inviteLocale, ...input }, ctx) => {
  if (!idNumber) throw new UserError("common.validation.required", { field: "idNumber" })
  const uiLocale = await getLocale()
  const locale = inviteLocale ?? inviteLocales.find((l) => l === uiLocale) ?? "tr"
  const values = { ...input, bio: emptyToNull(input.bio), idNumberEnc: encrypt(idNumber) }

  const { id, token } = await db
    .transaction(async (tx) => {
      await assertEmailFree(tx, input.email)
      const [row] = await tx.insert(instructors).values(values).returning({ id: instructors.id })
      const token = await issueInvite(tx, row.id)
      await ctx.audit(
        { action: "instructor.create", entity: "instructor", entityId: row.id, data: pick(values, PUBLIC_FIELDS) },
        tx,
      )
      return { id: row.id, token }
    })
    .catch(friendly)

  const invited = await sendInvite(input.email, input.displayName, locale, token)
  await ctx.audit({ action: "instructor.invite", entity: "instructor", entityId: id, data: { locale, sent: invited } })
  revalidate()
  return { id, invited }
})

/**
 * Save changes. An empty ID number keeps the stored one. A new email address
 * needs verifying again, and links sent to the old address stop working.
 */
export const updateInstructor = adminAction(
  instructorUpdateSchema,
  async ({ id, idNumber, ...input }, ctx) => {
    const after = { ...input, bio: emptyToNull(input.bio) }

    const { oldPhoto, inviteCancelled } = await db
      .transaction(async (tx) => {
        const [before] = await tx
          .select({
            displayName: instructors.displayName,
            teachingField: instructors.teachingField,
            bio: instructors.bio,
            teachingLanguages: instructors.teachingLanguages,
            website: instructors.website,
            photoPath: instructors.photoPath,
            officialName: instructors.officialName,
            mobile: instructors.mobile,
            email: instructors.email,
            idNumberEnc: instructors.idNumberEnc,
          })
          .from(instructors)
          .where(eq(instructors.id, id))
          .for("update")
        if (!before) throw notFound()

        const publicDiff = changes(pick(before, PUBLIC_FIELDS), pick(after, PUBLIC_FIELDS))
        const privateChanged: string[] = PRIVATE_FIELDS.filter((k) => before[k] !== after[k])
        const idChanged = idNumber !== undefined && idNumber !== safeDecrypt(before.idNumberEnc)
        if (idChanged) privateChanged.push("idNumber")
        if (Object.keys(publicDiff).length === 0 && privateChanged.length === 0) {
          return { oldPhoto: null, inviteCancelled: false }
        }

        const emailChanged = before.email !== after.email
        if (emailChanged) await assertEmailFree(tx, after.email, id)
        await tx
          .update(instructors)
          .set({
            ...after,
            ...(idChanged && idNumber ? { idNumberEnc: encrypt(idNumber) } : {}),
            ...(emailChanged ? { emailVerifiedAt: null } : {}),
            updatedAt: sql`now()`,
          })
          .where(eq(instructors.id, id))

        let inviteCancelled = false
        if (emailChanged) {
          const removed = await tx
            .delete(emailTokens)
            .where(and(ofInstructor(id), isNull(emailTokens.usedAt)))
            .returning({ purpose: emailTokens.purpose })
          inviteCancelled = removed.some((r) => r.purpose === "invite")
        }

        await ctx.audit(
          {
            action: "instructor.update",
            entity: "instructor",
            entityId: id,
            data: { ...publicDiff, ...(privateChanged.length ? { privateFields: privateChanged } : {}) },
          },
          tx,
        )
        return { oldPhoto: before.photoPath !== after.photoPath ? before.photoPath : null, inviteCancelled }
      })
      .catch(friendly)

    if (oldPhoto) await removePhoto(oldPhoto)
    revalidate()
    return { id, inviteCancelled }
  },
)

function safeDecrypt(payload: string): string | null {
  try {
    return decrypt(payload)
  } catch {
    return null
  }
}

/** Show the full ID number once. Every reveal is written to the audit log. */
export const revealIdNumber = adminAction(instructorIdSchema, async ({ id }, ctx) => {
  const [row] = await db
    .select({ idNumberEnc: instructors.idNumberEnc })
    .from(instructors)
    .where(eq(instructors.id, id))
    .limit(1)
  if (!row) throw notFound()
  const idNumber = safeDecrypt(row.idNumberEnc)
  if (idNumber === null) throw new UserError("instructors.errors.idUnreadable")
  await ctx.audit({ action: "instructor.reveal_id", entity: "instructor", entityId: id })
  return { idNumber }
})

/** Send a new invitation (the previous link stops working). Only for active instructors without a password. */
export const resendInvite = adminAction(resendInviteSchema, async ({ id, locale }, ctx) => {
  const { token, email, displayName } = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        email: instructors.email,
        displayName: instructors.displayName,
        active: instructors.active,
        passwordHash: instructors.passwordHash,
      })
      .from(instructors)
      .where(eq(instructors.id, id))
      .for("update")
    if (!row) throw notFound()
    if (!row.active) throw new UserError("instructors.errors.inviteInactive")
    if (row.passwordHash) throw new UserError("instructors.errors.alreadySetUp")
    return { token: await issueInvite(tx, id), email: row.email, displayName: row.displayName }
  })

  const sent = await sendInvite(email, displayName, locale, token)
  await ctx.audit({ action: "instructor.invite", entity: "instructor", entityId: id, data: { locale, sent } })
  revalidate()
  if (!sent) throw new UserError("instructors.errors.inviteNotSent")
  return { id }
})

/**
 * Deactivate (signed out everywhere, emailed links stop working, hidden from
 * workshop forms) or activate again. Workshops and contracts stay as they are.
 */
export const setInstructorActive = adminAction(instructorActiveSchema, async ({ id, active }, ctx) => {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ active: instructors.active })
      .from(instructors)
      .where(eq(instructors.id, id))
      .for("update")
    if (!row) throw notFound()
    if (row.active === active) return
    await tx.update(instructors).set({ active, updatedAt: sql`now()` }).where(eq(instructors.id, id))
    if (!active) {
      await tx.delete(sessions).where(and(eq(sessions.kind, "instructor"), eq(sessions.subjectId, id)))
      await tx.delete(emailTokens).where(and(ofInstructor(id), isNull(emailTokens.usedAt)))
    }
    await ctx.audit(
      { action: active ? "instructor.activate" : "instructor.deactivate", entity: "instructor", entityId: id },
      tx,
    )
  })
  revalidate()
  return { id, active }
})

/** Delete only an instructor with no workshops and no contracts; otherwise deactivate them. */
export const deleteInstructor = adminAction(instructorIdSchema, async ({ id }, ctx) => {
  const photo = await db
    .transaction(async (tx) => {
      // Lock the row: a workshop or contract added meanwhile waits, then fails its foreign key.
      const [row] = await tx
        .select({ displayName: instructors.displayName, photoPath: instructors.photoPath })
        .from(instructors)
        .where(eq(instructors.id, id))
        .for("update")
      if (!row) throw notFound()
      const [{ workshops }] = await tx.select({ workshops: count() }).from(courses).where(eq(courses.instructorId, id))
      const [{ signed }] = await tx.select({ signed: count() }).from(contracts).where(eq(contracts.instructorId, id))
      if (workshops > 0 || signed > 0) throw new UserError("instructors.errors.inUse")

      await tx.delete(sessions).where(and(eq(sessions.kind, "instructor"), eq(sessions.subjectId, id)))
      await tx.delete(emailTokens).where(ofInstructor(id))
      await tx.delete(instructors).where(eq(instructors.id, id))
      await ctx.audit(
        { action: "instructor.delete", entity: "instructor", entityId: id, data: { displayName: row.displayName } },
        tx,
      )
      return row.photoPath
    })
    .catch(friendly)

  if (photo) await removePhoto(photo)
  revalidate()
  return { id }
})
