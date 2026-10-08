"use server"

import { and, eq, ne, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { getLocale } from "next-intl/server"

import { db, type Tx } from "@/db"
import { adminInvites, admins, auditLog, emailTokens, sessions } from "@/db/schema"
import { absoluteLocaleUrl, localeHref } from "@/i18n/links"
import { adminAction, publicAction, UserError } from "@/lib/action"
import { changes } from "@/lib/audit"
import { verifyPassword } from "@/lib/auth/password"
import { createRateLimiter } from "@/lib/auth/rate-limit"
import { endSession, startSession } from "@/lib/auth/session"
import { unusedTokensOf } from "@/lib/auth/tokens"
import { sendEmail } from "@/lib/email"
import { errorForLog, PG, pgError } from "@/lib/errors"
import { read, remove } from "@/lib/storage"
import type { AppLocale } from "@/i18n/routing"
import {
  acceptPartnerInvite,
  assertEmailFree,
  cancelPartnerInvite as cancelInvite,
  createPartnerInvite,
  lockPartners,
  renewPartnerInvite,
} from "./invites"
import {
  aboutProfileSchema,
  acceptPartnerInviteSchema,
  partnerInviteIdSchema,
  partnerInviteSchema,
  profileSchema,
  withAdminNotice,
} from "./schema"

/**
 * Partners: invitations (partners page), the invitation's page and each
 * partner's own profile. The logic of invitations is in `./invites`.
 */

const MINUTE = 60_000
/** Invitation emails (inviting and sending again): 10 per partner per hour. */
const inviteLimiter = createRateLimiter({ limit: 10, windowMs: 60 * MINUTE })
/** A new email checks the password: 5 tries per partner per 15 minutes. */
const passwordLimiter = createRateLimiter({ limit: 5, windowMs: 15 * MINUTE })

const revalidatePartners = () => revalidatePath("/[locale]/admin/money/partners", "page")

/** The invitation link (absolute, so it can also be copied and sent another way) and whether the email went out. */
async function sendPartnerInvite(
  invite: { email: string; name: string; locale: AppLocale },
  inviterName: string,
  token: string,
): Promise<{ inviteUrl: string; emailed: boolean }> {
  const inviteUrl = await absoluteLocaleUrl(invite.locale, `/admin/invite?token=${encodeURIComponent(token)}`)
  const result = await sendEmail({
    to: invite.email,
    template: "partner_invite",
    locale: invite.locale,
    props: { name: invite.name, inviterName, acceptUrl: inviteUrl },
  })
  return { inviteUrl, emailed: result.ok }
}

/**
 * Invite a partner (any signed-in partner can). The invitation email goes out
 * in the chosen language; the link is returned too, shown once to copy (for
 * WhatsApp, or when no email could be sent: `emailed: false`).
 */
export const invitePartner = adminAction(partnerInviteSchema, async (input, ctx) => {
  if (!inviteLimiter.consume(ctx.admin.id).ok) throw new UserError("partners.errors.rateLimited")
  const { id, token } = await createPartnerInvite(input, ctx.admin.id)
  const sent = await sendPartnerInvite(input, ctx.admin.name, token)
  revalidatePartners()
  return { id, ...sent }
})

/** "Send again": a new link for 7 more days (the old one stops working), emailed and returned once to copy. */
export const resendPartnerInvite = adminAction(partnerInviteIdSchema, async ({ id }, ctx) => {
  if (!inviteLimiter.consume(ctx.admin.id).ok) throw new UserError("partners.errors.rateLimited")
  const { token, inviterName, ...invite } = await renewPartnerInvite(id, ctx.admin.id)
  const sent = await sendPartnerInvite(invite, inviterName, token)
  revalidatePartners()
  return { id, ...sent }
})

/** Cancel an invitation: the link stops working and the place is free again. */
export const cancelPartnerInvite = adminAction(partnerInviteIdSchema, async ({ id }, ctx) => {
  await cancelInvite(id, ctx.admin.id)
  revalidatePartners()
  return { id }
})

/**
 * The invitation link's page (signed out): choose a password, then straight
 * into the panel, signed in as the new partner, with a welcome notice. A
 * session this browser still had (e.g. the inviter trying the link) ends first.
 */
export const acceptPartnerInviteAction = publicAction(
  acceptPartnerInviteSchema,
  async ({ token, password }) => {
    const { adminId } = await acceptPartnerInvite(token, password)
    await endSession("admin")
    await startSession("admin", adminId)
    redirect(withAdminNotice(await localeHref(await getLocale(), "/admin"), "welcome"))
  },
  { rateLimit: { limit: 10, windowMs: 15 * MINUTE } },
)

// ─── My profile ───────────────────────────────────────────────────────────────

/**
 * Turn database constraint errors into friendly messages, and the invitation
 * page's wording into the profile's (there is no list of invitations here).
 */
function friendly(err: unknown): never {
  const pg = pgError(err)
  if (pg?.code === PG.uniqueViolation && pg.constraint === "admins_email_unique") {
    throw new UserError("partners.errors.emailTaken", { field: "email" })
  }
  if (err instanceof UserError && err.key === "partners.errors.emailInvited") {
    throw new UserError("partners.profile.errors.emailInvited", { field: "email" })
  }
  throw err
}

/**
 * Whether this admin uploaded the file for `purpose` (their photo, or their
 * portrait: the upload route's audit entry says so). The entry outlives the
 * file, so see `stillStored` too.
 */
async function uploadedBy(tx: Tx, path: string, adminId: string, purpose: "admin_photo" | "partner_portrait" = "admin_photo"): Promise<boolean> {
  const [row] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "media.upload"),
        eq(auditLog.entity, "media"),
        eq(auditLog.entityId, path),
        eq(auditLog.adminId, adminId),
        sql`${auditLog.data} ->> 'purpose' = ${purpose}`,
      ),
    )
    .limit(1)
  return Boolean(row)
}

/**
 * Whether the photo file is still in storage. A form left open on
 * another device still holds the photo it was loaded with, which a later save
 * there may already have removed: taking it back would point at a missing
 * file and remove the current one. A storage error counts as missing.
 */
async function stillStored(path: string): Promise<boolean> {
  const file = await read(path).catch(() => null)
  await file?.body.cancel().catch(() => {})
  return file !== null
}

/** Names of the profile fields in the audit log. */
const FIELDS = { name: "name", email: "email", photoPath: "photo" } as const

/**
 * Save my profile: name, email and photo. A new email needs the current
 * password, must not belong to another admin or a working invitation, and
 * signs out my other devices (this one stays signed in); password links sent
 * to the old address stop working, and an expired invitation of the new
 * address goes. A new photo must be one I uploaded (purpose `admin_photo`)
 * and still be stored; the old photo file is removed after the save. Audited as
 * `admin.profile_update` with the names of the changed fields (and the name's
 * change), never the password.
 */
export const updateMyProfile = adminAction(profileSchema, async ({ currentPassword, ...after }, ctx) => {
  const id = ctx.admin.id
  const [current] = await db
    .select({ email: admins.email, passwordHash: admins.passwordHash })
    .from(admins)
    .where(eq(admins.id, id))
    .limit(1)
  if (!current) throw new UserError("common.errors.notFound")

  // A new email: check the password first (Argon2 is slow, so outside the transaction).
  const checked = after.email !== current.email
  if (checked) {
    if (!currentPassword) throw new UserError("partners.profile.errors.passwordNeeded", { field: "currentPassword" })
    if (!passwordLimiter.consume(id).ok) throw new UserError("partners.profile.errors.rateLimited")
    if (!(await verifyPassword(current.passwordHash, currentPassword))) {
      throw new UserError("partners.profile.errors.wrongPassword", { field: "currentPassword" })
    }
  }

  const { oldPhoto, emailChanged } = await db
    .transaction(async (tx) => {
      if (checked) await lockPartners(tx) // invitations and other email changes wait
      const [before] = await tx
        .select({ name: admins.name, email: admins.email, photoPath: admins.photoPath, passwordHash: admins.passwordHash })
        .from(admins)
        .where(eq(admins.id, id))
        .for("update")
      if (!before) throw new UserError("common.errors.notFound")
      const emailChanged = after.email !== before.email
      // Changed meanwhile (another tab): the password checked above must still be the one for this email.
      if (emailChanged && (!checked || before.passwordHash !== current.passwordHash || before.email !== current.email)) {
        throw new UserError("partners.profile.errors.passwordNeeded", { field: "currentPassword" })
      }
      if (
        after.photoPath &&
        after.photoPath !== before.photoPath &&
        !((await uploadedBy(tx, after.photoPath, id)) && (await stillStored(after.photoPath)))
      ) {
        throw new UserError("partners.profile.errors.photo", { field: "photoPath" })
      }

      const changed = (Object.keys(FIELDS) as (keyof typeof FIELDS)[]).filter((k) => before[k] !== after[k])
      if (!changed.length) return { oldPhoto: null, emailChanged: false }
      if (emailChanged) await assertEmailFree(tx, after.email, new Date(), { adminId: id })

      await tx.update(admins).set(after).where(eq(admins.id, id))
      if (emailChanged) {
        await tx
          .delete(sessions)
          .where(and(eq(sessions.kind, "admin"), eq(sessions.subjectId, id), ne(sessions.id, ctx.sessionId)))
        await tx.delete(emailTokens).where(unusedTokensOf("admin", id, "reset_password"))
        // An expired invitation of this address (a working one was refused above) could never be sent again.
        await tx.delete(adminInvites).where(eq(adminInvites.email, after.email))
      }
      await ctx.audit(
        {
          action: "admin.profile_update",
          entity: "admin",
          entityId: id,
          data: {
            fields: changed.map((k) => FIELDS[k]),
            ...(before.name !== after.name ? { name: { from: before.name, to: after.name } } : {}),
          },
        },
        tx,
      )
      return { oldPhoto: before.photoPath !== after.photoPath ? before.photoPath : null, emailChanged }
    })
    .catch(friendly)

  if (oldPhoto) {
    await remove(oldPhoto).catch((err) =>
      console.error("[partners] could not remove the old photo", errorForLog(err)),
    )
  }
  // The header's name and photo, and the partners page.
  revalidatePath("/[locale]/admin", "layout")
  return { emailChanged }
})

/** Names of the Our story page's fields in the audit log. */
const ABOUT_FIELDS = { aboutShown: "shown", aboutName: "name", aboutRole: "role", aboutBio: "bio", portraitPath: "portrait" } as const

/**
 * Save my entry on the public Our story page: whether I am shown, my portrait, my
 * name, role and words about me in each language. A new portrait must be one
 * I uploaded (purpose `partner_portrait`) and still be stored; the old one is
 * removed after the save. Only my own entry: being on a public page is each
 * partner's own choice. Audited as `admin.about_update` with the changed
 * fields (and whether I am shown, and my role), not the long texts.
 */
export const updateMyAbout = adminAction(aboutProfileSchema, async (after, ctx) => {
  const id = ctx.admin.id
  const oldPortrait = await db
    .transaction(async (tx) => {
      const [before] = await tx
        .select({
          aboutShown: admins.aboutShown,
          aboutName: admins.aboutName,
          aboutRole: admins.aboutRole,
          aboutBio: admins.aboutBio,
          portraitPath: admins.portraitPath,
        })
        .from(admins)
        .where(eq(admins.id, id))
        .for("update")
      if (!before) throw new UserError("common.errors.notFound")
      if (
        after.portraitPath &&
        after.portraitPath !== before.portraitPath &&
        !((await uploadedBy(tx, after.portraitPath, id, "partner_portrait")) && (await stillStored(after.portraitPath)))
      ) {
        throw new UserError("partners.about.errors.portrait", { field: "portraitPath" })
      }

      const diff = changes(before, after)
      const changed = (Object.keys(ABOUT_FIELDS) as (keyof typeof ABOUT_FIELDS)[]).filter((k) => k in diff)
      if (!changed.length) return null

      await tx.update(admins).set(after).where(eq(admins.id, id))
      await ctx.audit(
        {
          action: "admin.about_update",
          entity: "admin",
          entityId: id,
          data: {
            fields: changed.map((k) => ABOUT_FIELDS[k]),
            ...(diff.aboutShown ? { shown: diff.aboutShown } : {}),
            ...(diff.aboutRole ? { role: diff.aboutRole } : {}),
          },
        },
        tx,
      )
      return before.portraitPath !== after.portraitPath ? before.portraitPath : null
    })

  if (oldPortrait) {
    await remove(oldPortrait).catch((err) =>
      console.error("[partners] could not remove the old portrait", errorForLog(err)),
    )
  }
  // My profile, and the public Our story page in every language.
  revalidatePath("/[locale]/admin", "layout")
  revalidatePath("/[locale]/story", "page")
})
