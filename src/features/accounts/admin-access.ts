import "server-only"
import { randomInt } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { hasLocale } from "next-intl"
import type { z } from "zod"

import { db } from "@/db"
import { emailTokens, instructors, members } from "@/db/schema"
import { profileText } from "@/features/instructors/schema"
import { absoluteLocaleUrl } from "@/i18n/links"
import { locales, type AppLocale } from "@/i18n/routing"
import { UserError, type AdminActionContext } from "@/lib/action"
import { auditImpersonationEnd } from "@/lib/auth/impersonation"
import { hashPassword } from "@/lib/auth/password"
import { createRateLimiter } from "@/lib/auth/rate-limit"
import { deleteSessionsOf, startImpersonation, type ImpersonableKind } from "@/lib/auth/session"
import { unusedTokensOf } from "@/lib/auth/tokens"
import { sendEmail } from "@/lib/email"
import type { AccountKind } from "./accounts"
import type { adminPasswordSchema } from "./schema"

/**
 * What a super admin can do for a member's or instructor's account: set a new
 * password ("Change password" on their admin page) and view the panel as them
 * ("Enter their panel"). The admin actions (features/instructors,
 * features/students) wrap these in `adminAction`.
 */

const MINUTE = 60_000
/** Setting passwords: 10 per admin per 15 minutes (both kinds count together). */
const passwordLimiter = createRateLimiter({ limit: 10, windowMs: 15 * MINUTE })

/** No 0/O, 1/l/I: easy to read out and type. 55 characters. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/**
 * A strong password to read out or send: 16 random characters (about 92
 * bits) in groups of four, "xK7m-Pq3z-…" (19 characters).
 */
export function generatePassword(): string {
  const chars = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)])
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-")
}

const notFound = (kind: AccountKind) =>
  new UserError(kind === "member" ? "students.errors.notFound" : "instructors.errors.notFound")

const asLocale = (value: string): AppLocale => (hasLocale(locales, value) ? value : "tr")

export type SetPasswordResult = {
  /** Whether the "your password was changed" email went out. */
  emailed: boolean
  /** Only for a generated password: shown once to the admin, never stored or logged. */
  password?: string
}

/**
 * Set a member's or instructor's password. Like the person's own reset, the
 * lockout is cleared, every session of theirs ends (also an admin viewing as
 * them) and their open reset links stop working; an instructor who was only
 * invited has their invitation used up (the account is complete). Unlike it,
 * the email is not marked confirmed (nothing proved the inbox) and a
 * confirmation link stays valid. A deactivated instructor is refused. The
 * person is emailed (`password_changed_by_team`); a failed email does not
 * undo the change. Audited as `<kind>.password_set`, never with the password.
 */
export async function setPasswordAsAdmin(
  kind: AccountKind,
  input: z.output<typeof adminPasswordSchema>,
  ctx: AdminActionContext,
): Promise<SetPasswordResult> {
  if (!passwordLimiter.consume(ctx.admin.id).ok) throw new UserError("admin.access.password.errors.rateLimited")
  const generated = input.mode === "generate"
  const password = input.mode === "generate" ? generatePassword() : input.password
  const passwordHash = await hashPassword(password) // slow: before the transaction
  const { id } = input

  const person = await db.transaction(async (tx) => {
    let person: { email: string; name: string; locale: AppLocale }
    if (kind === "member") {
      const [row] = await tx
        .select({ email: members.email, name: members.name, locale: members.locale })
        .from(members)
        .where(eq(members.id, id))
        .for("update")
      if (!row) throw notFound(kind)
      person = { email: row.email, name: row.name, locale: asLocale(row.locale) }
      await tx.update(members).set({ passwordHash, failedLogins: 0, lockedUntil: null }).where(eq(members.id, id))
    } else {
      const [row] = await tx
        .select({
          email: instructors.email,
          displayName: instructors.displayName,
          locale: instructors.locale,
          active: instructors.active,
        })
        .from(instructors)
        .where(eq(instructors.id, id))
        .for("update")
      if (!row) throw notFound(kind)
      if (!row.active) throw new UserError("instructors.errors.passwordInactive")
      const locale = asLocale(row.locale)
      person = { email: row.email, name: profileText(row.displayName, locale), locale }
      await tx
        .update(instructors)
        .set({ passwordHash, failedLogins: 0, lockedUntil: null, updatedAt: sql`now()` })
        .where(eq(instructors.id, id))
    }
    const removed = await tx
      .delete(emailTokens)
      .where(and(unusedTokensOf(kind, id), inArray(emailTokens.purpose, ["reset_password", "invite"])))
      .returning({ purpose: emailTokens.purpose })
    await deleteSessionsOf(kind, id, tx)
    await ctx.audit(
      {
        action: `${kind}.password_set`,
        entity: kind,
        entityId: id,
        data: { generated, ...(removed.some((r) => r.purpose === "invite") ? { inviteCompleted: true } : {}) },
      },
      tx,
    )
    return person
  })

  const sent = await sendEmail({
    to: person.email,
    template: "password_changed_by_team",
    locale: person.locale,
    props: {
      name: person.name,
      loginUrl: await absoluteLocaleUrl(person.locale, kind === "member" ? "/account/login" : "/instructor/login"),
    },
  })
  return { emailed: sent.ok, ...(generated ? { password } : {}) }
}

/**
 * "Enter their panel": this browser gets a one-hour session as the instructor
 * or member (the session of that kind it had ends). The admin's own session
 * stays. A deactivated instructor is refused; an admin can never be viewed as.
 * The caller redirects to the panel right away.
 */
export async function impersonate(kind: ImpersonableKind, id: string, ctx: AdminActionContext): Promise<void> {
  if (kind === "member") {
    const [row] = await db.select({ id: members.id }).from(members).where(eq(members.id, id)).limit(1)
    if (!row) throw notFound(kind)
  } else {
    const [row] = await db
      .select({ active: instructors.active })
      .from(instructors)
      .where(eq(instructors.id, id))
      .limit(1)
    if (!row) throw notFound(kind)
    if (!row.active) throw new UserError("instructors.errors.impersonateInactive")
  }
  // The audit entries go in the session's own transaction: no viewing without its start entry.
  await startImpersonation(kind, id, ctx.admin.id, async (tx, replaced) => {
    if (replaced?.impersonatedBy) {
      await auditImpersonationEnd(kind, replaced.subjectId, replaced.impersonatedBy, "replaced", tx)
    }
    await ctx.audit({ action: `${kind}.impersonate`, entity: kind, entityId: id }, tx)
  })
}
