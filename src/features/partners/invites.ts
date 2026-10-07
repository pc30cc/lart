import "server-only"
import { and, count, eq, gt, lte, ne, sql } from "drizzle-orm"

import { db, type Db, type Tx } from "@/db"
import { adminInvites, admins } from "@/db/schema"
import { UserError } from "@/lib/errors"
import { audit } from "@/lib/audit"
import { normalizeEmail } from "@/lib/auth/login"
import { hashPassword } from "@/lib/auth/password"
import { isTokenShaped } from "@/lib/auth/tokens"
import { randomToken, sha256 } from "@/lib/crypto"
import type { AppLocale } from "@/i18n/routing"
import { MAX_PARTNERS, PARTNER_INVITE_TTL_MS, PARTNERS_LOCK } from "./limits"

/**
 * Partner invitations: a partner invites someone by name and email; the admin
 * row is created only when the invitation is accepted (so every list of
 * admins stays as it is until then). At most `MAX_PARTNERS` active partners
 * and working invitations together. The link carries a 256-bit token; only
 * its SHA-256 is stored, and a link works once, for 7 days.
 *
 * Every change takes the partners lock first (`lockPartners`). The actions in
 * `./actions` add the session, the emails and the rate limits around these.
 * `exec`, `now` and `max` are for tests (a transaction that is rolled back, a
 * fixed clock, a limit above the shared test database's admins).
 */

type Options = { exec?: Db | Tx; now?: Date; max?: number }

/** Serialise everything that changes the partner count or partner emails (`PARTNERS_LOCK`). */
export async function lockPartners(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PARTNERS_LOCK}))`)
}

const working = (now: Date) => gt(adminInvites.expiresAt, now)

/** How many places are taken: active partners plus invitations that still work. */
export async function partnerSlots(exec: Db | Tx = db, now = new Date(), max = MAX_PARTNERS) {
  const [{ active }] = await exec.select({ active: count() }).from(admins).where(eq(admins.active, true))
  const [{ invited }] = await exec.select({ invited: count() }).from(adminInvites).where(working(now))
  return { max, active, invited, free: Math.max(0, max - active - invited) }
}

/**
 * A partner's email must be new: no admin has it (active or not, letter case
 * aside) and no other working invitation is for it. Friendly errors on the
 * `email` field.
 */
export async function assertEmailFree(
  tx: Db | Tx,
  email: string,
  now: Date,
  except: { adminId?: string; inviteId?: string } = {},
) {
  const [admin] = await tx
    .select({ id: admins.id })
    .from(admins)
    .where(and(sql`lower(${admins.email}) = ${email}`, except.adminId ? ne(admins.id, except.adminId) : undefined))
    .limit(1)
  if (admin) throw new UserError("partners.errors.emailTaken", { field: "email" })
  const [invite] = await tx
    .select({ id: adminInvites.id })
    .from(adminInvites)
    .where(
      and(
        eq(adminInvites.email, email),
        working(now),
        except.inviteId ? ne(adminInvites.id, except.inviteId) : undefined,
      ),
    )
    .limit(1)
  if (invite) throw new UserError("partners.errors.emailInvited", { field: "email" })
}

/** Every place is taken. `invited` (working invitations) decides the advice: cancel one, or the team is simply full. */
const limitReached = ({ max, invited }: { max: number; invited: number }) =>
  new UserError("partners.errors.limit", { values: { max, invited } })
const inviteNotFound = () => new UserError("partners.errors.inviteNotFound")
const expiry = (now: Date) => new Date(now.getTime() + PARTNER_INVITE_TTL_MS)

export type PartnerInviteInput = { name: string; email: string; locale: AppLocale }

/**
 * Invite a partner. Refused when the email belongs to an admin or has a
 * working invitation, or when every place is taken. An expired invitation of
 * the same address is replaced. Audited as `admin.invite` (never the token).
 * Returns the token for the link (never stored).
 */
export async function createPartnerInvite(
  input: PartnerInviteInput,
  invitedBy: string,
  { exec = db, now = new Date(), max = MAX_PARTNERS }: Options = {},
): Promise<{ id: string; token: string }> {
  const email = normalizeEmail(input.email)
  return exec.transaction(async (tx) => {
    await lockPartners(tx)
    await assertEmailFree(tx, email, now)
    const slots = await partnerSlots(tx, now, max)
    if (slots.free < 1) throw limitReached(slots)
    await tx.delete(adminInvites).where(and(eq(adminInvites.email, email), lte(adminInvites.expiresAt, now)))

    const token = randomToken()
    const [row] = await tx
      .insert(adminInvites)
      .values({
        email,
        name: input.name,
        locale: input.locale,
        tokenHash: sha256(token),
        invitedBy,
        expiresAt: expiry(now),
        createdAt: now,
      })
      .returning({ id: adminInvites.id })
    await audit(
      {
        adminId: invitedBy,
        action: "admin.invite",
        entity: "admin_invite",
        entityId: row.id,
        data: { name: input.name, email, locale: input.locale },
      },
      tx,
    )
    return { id: row.id, token }
  })
}

export type RenewedInvite = { token: string; email: string; name: string; locale: AppLocale; inviterName: string }

/**
 * "Send again": a new link for 7 more days; the previous link stops working.
 * An expired invitation no longer holds a place, so it needs a free one again.
 * Audited as `admin.invite_resend`.
 */
export async function renewPartnerInvite(
  id: string,
  by: string,
  { exec = db, now = new Date(), max = MAX_PARTNERS }: Options = {},
): Promise<RenewedInvite> {
  return exec.transaction(async (tx) => {
    await lockPartners(tx)
    const [invite] = await tx
      .select({
        email: adminInvites.email,
        name: adminInvites.name,
        locale: adminInvites.locale,
        expiresAt: adminInvites.expiresAt,
        inviterName: admins.name,
      })
      .from(adminInvites)
      .innerJoin(admins, eq(admins.id, adminInvites.invitedBy))
      .where(eq(adminInvites.id, id))
      .for("update", { of: adminInvites })
    if (!invite) throw inviteNotFound()
    // Someone may have become a partner with this email meanwhile (e.g. with the setup command).
    await assertEmailFree(tx, invite.email, now, { inviteId: id })
    if (invite.expiresAt <= now) {
      const slots = await partnerSlots(tx, now, max)
      if (slots.free < 1) throw limitReached(slots)
    }

    const token = randomToken()
    await tx
      .update(adminInvites)
      .set({ tokenHash: sha256(token), expiresAt: expiry(now) })
      .where(eq(adminInvites.id, id))
    await audit(
      {
        adminId: by,
        action: "admin.invite_resend",
        entity: "admin_invite",
        entityId: id,
        data: { name: invite.name, email: invite.email, locale: invite.locale },
      },
      tx,
    )
    return {
      token,
      email: invite.email,
      name: invite.name,
      locale: invite.locale as AppLocale,
      inviterName: invite.inviterName,
    }
  })
}

/** Cancel an invitation: its link stops working and its place is free. Audited as `admin.invite_cancel`. */
export async function cancelPartnerInvite(id: string, by: string, { exec = db }: Options = {}): Promise<void> {
  await exec.transaction(async (tx) => {
    await lockPartners(tx)
    const [removed] = await tx
      .delete(adminInvites)
      .where(eq(adminInvites.id, id))
      .returning({ name: adminInvites.name, email: adminInvites.email })
    if (!removed) throw inviteNotFound()
    await audit(
      { adminId: by, action: "admin.invite_cancel", entity: "admin_invite", entityId: id, data: removed },
      tx,
    )
  })
}

export type PartnerInviteDetails = {
  name: string
  email: string
  locale: AppLocale
  inviterName: string
  expiresAt: Date
}

/** Who a working invitation link is for and who sent it (the invitation page), or null. Does not use the link. */
export async function partnerInviteDetails(
  token: unknown,
  { exec = db, now = new Date() }: Options = {},
): Promise<PartnerInviteDetails | null> {
  if (!isTokenShaped(token)) return null
  const [row] = await exec
    .select({
      name: adminInvites.name,
      email: adminInvites.email,
      locale: adminInvites.locale,
      inviterName: admins.name,
      expiresAt: adminInvites.expiresAt,
    })
    .from(adminInvites)
    .innerJoin(admins, eq(admins.id, adminInvites.invitedBy))
    .where(and(eq(adminInvites.tokenHash, sha256(token)), working(now)))
    .limit(1)
  return row ? { ...row, locale: row.locale as AppLocale } : null
}

/**
 * Accept an invitation, in one transaction: the link must still work; the
 * limit is checked again (only active partners count: this invitation's place
 * is its own) and so is the email (a partner may have been added with it
 * meanwhile). Then the partner is created (active, 0 % profit share) with the
 * password, the invitation is deleted (the link works once) and
 * `admin.accept_invite` is audited as the new partner. Returns the new admin id.
 */
export async function acceptPartnerInvite(
  token: unknown,
  password: string,
  { exec = db, now = new Date(), max = MAX_PARTNERS }: Options = {},
): Promise<{ adminId: string }> {
  if (!isTokenShaped(token)) throw new UserError("partners.accept.errors.invalidLink")
  const passwordHash = await hashPassword(password) // before the transaction: Argon2 is slow
  return exec.transaction(async (tx) => {
    await lockPartners(tx)
    const [invite] = await tx
      .select()
      .from(adminInvites)
      .where(and(eq(adminInvites.tokenHash, sha256(token)), working(now)))
      .for("update")
    if (!invite) throw new UserError("partners.accept.errors.invalidLink")
    const [taken] = await tx
      .select({ id: admins.id })
      .from(admins)
      .where(sql`lower(${admins.email}) = ${invite.email}`)
      .limit(1)
    if (taken) throw new UserError("partners.accept.errors.emailTaken")
    const { active } = await partnerSlots(tx, now, max)
    if (active >= max) throw new UserError("partners.accept.errors.limit", { values: { max } })

    const [admin] = await tx
      .insert(admins)
      .values({ email: invite.email, name: invite.name, passwordHash, shareBp: 0, active: true })
      .returning({ id: admins.id })
    await tx.delete(adminInvites).where(eq(adminInvites.id, invite.id))
    await audit(
      {
        adminId: admin.id,
        action: "admin.accept_invite",
        entity: "admin",
        entityId: admin.id,
        data: { name: invite.name, email: invite.email, invitedBy: invite.invitedBy },
      },
      tx,
    )
    return { adminId: admin.id }
  })
}
