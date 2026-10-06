import "server-only"
import { and, eq, gt, inArray, isNull } from "drizzle-orm"

import { db, type Tx } from "@/db"
import { admins, emailTokens } from "@/db/schema"
import { audit } from "@/lib/audit"
import { randomToken, sha256 } from "@/lib/crypto"
import { sendEmail } from "@/lib/email"
import { normalizeEmail } from "./login"
import { hashPassword, verifyPassword } from "./password"
import { deleteSessionsOf } from "./session"

/**
 * Super-admin password change and reset. The actions in `./actions` add the
 * rate limits, the session cookie and the redirects around these.
 */

/** How long a reset link works. */
export const RESET_TOKEN_MS = 30 * 60_000

const unusedResetTokens = (adminId: string) =>
  and(
    eq(emailTokens.kind, "admin"),
    eq(emailTokens.subjectId, adminId),
    eq(emailTokens.purpose, "reset_password"),
    isNull(emailTokens.usedAt),
  )

/** Store a new password: clears the lockout, drops open reset links and signs the admin out everywhere. */
async function setPassword(tx: Tx, adminId: string, passwordHash: string) {
  await tx.update(admins).set({ passwordHash, failedLogins: 0, lockedUntil: null }).where(eq(admins.id, adminId))
  await tx.delete(emailTokens).where(unusedResetTokens(adminId))
  await deleteSessionsOf("admin", adminId, tx)
}

/**
 * Change a signed-in admin's password after checking the current one.
 * Returns false when the current password is wrong. Every session of the
 * admin ends (the caller starts a new one for this device).
 */
export async function changeAdminPassword(adminId: string, current: string, next: string): Promise<boolean> {
  const [row] = await db.select({ hash: admins.passwordHash }).from(admins).where(eq(admins.id, adminId)).limit(1)
  if (!row || !(await verifyPassword(row.hash, current))) return false
  const passwordHash = await hashPassword(next)
  await db.transaction(async (tx) => {
    await setPassword(tx, adminId, passwordHash)
    await audit({ adminId, action: "auth.password_change", entity: "admin", entityId: adminId }, tx)
  })
  return true
}

/** A new reset link token for an admin (replaces any unused one). Only its SHA-256 is stored. */
export async function issueAdminResetToken(adminId: string, now = new Date()): Promise<string> {
  const token = randomToken()
  await db.transaction(async (tx) => {
    await tx.delete(emailTokens).where(unusedResetTokens(adminId))
    await tx.insert(emailTokens).values({
      id: sha256(token),
      purpose: "reset_password",
      kind: "admin",
      subjectId: adminId,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_MS),
      createdAt: now,
    })
  })
  return token
}

/** Conditions of a reset link that still works: unused, not expired, for an active admin. */
const validResetToken = (token: string, now: Date) =>
  and(
    eq(emailTokens.id, sha256(token)),
    eq(emailTokens.purpose, "reset_password"),
    eq(emailTokens.kind, "admin"),
    isNull(emailTokens.usedAt),
    gt(emailTokens.expiresAt, now),
    inArray(emailTokens.subjectId, db.select({ id: admins.id }).from(admins).where(eq(admins.active, true))),
  )

/** True when a reset link still works (the reset page checks this before showing the form). */
export async function isAdminResetTokenValid(token: string, now = new Date()): Promise<boolean> {
  if (!token || token.length > 128) return false
  const [row] = await db.select({ id: emailTokens.id }).from(emailTokens).where(validResetToken(token, now)).limit(1)
  return Boolean(row)
}

/**
 * Set a new password from a reset link. In one transaction: marks the link
 * used, stores the password, ends every session and audits. Returns the admin
 * id, or null when the link no longer works.
 */
export async function resetAdminPassword(token: string, password: string, now = new Date()): Promise<string | null> {
  if (!token || token.length > 128) return null
  const passwordHash = await hashPassword(password) // before the transaction: Argon2 is slow
  return db.transaction(async (tx) => {
    const [used] = await tx
      .update(emailTokens)
      .set({ usedAt: now })
      .where(validResetToken(token, now))
      .returning({ adminId: emailTokens.subjectId })
    if (!used) return null
    await setPassword(tx, used.adminId, passwordHash)
    await audit({ adminId: used.adminId, action: "auth.password_reset", entity: "admin", entityId: used.adminId }, tx)
    return used.adminId
  })
}

/**
 * "Forgot your password?": email a reset link when the address belongs to an
 * active admin; otherwise do nothing. Callers run it after the response, so
 * the answer and its timing are the same either way.
 */
export async function sendAdminResetLink(emailInput: string, locale: string): Promise<void> {
  const [admin] = await db
    .select({ id: admins.id, name: admins.name, email: admins.email })
    .from(admins)
    .where(and(eq(admins.email, normalizeEmail(emailInput)), eq(admins.active, true)))
    .limit(1)
  if (!admin) return
  const token = await issueAdminResetToken(admin.id)
  const sent = await sendEmail({
    to: admin.email,
    template: "password_reset",
    props: { name: admin.name, resetUrl: `/${locale}/admin/login/reset?token=${token}` },
    locale,
  })
  await audit({
    adminId: null,
    action: "auth.password_reset_request",
    entity: "admin",
    entityId: admin.id,
    data: { sent: sent.ok },
  })
}
