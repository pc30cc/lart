import "server-only"
import { eq, inArray, sql } from "drizzle-orm"

import { db, type Tx } from "@/db"
import { emailTokens, instructors, members } from "@/db/schema"
import { profileText } from "@/features/instructors/schema"
import { normalizeEmail } from "@/lib/auth/login"
import { hashPassword } from "@/lib/auth/password"
import { deleteSessionsOf } from "@/lib/auth/session"
import {
  consumeEmailToken,
  issueEmailToken,
  isTokenShaped,
  peekEmailToken,
  TOKEN_TTL,
  unusedTokensOf,
  type TokenPurpose,
} from "@/lib/auth/tokens"
import { sendEmail } from "@/lib/email"

/**
 * Member (student) and instructor accounts: sign-up, the emailed links
 * (verify, reset, invitation) and passwords. The actions in `./actions` add
 * the rate limits, the session cookie and the redirects around these.
 */

export type AccountKind = "member" | "instructor"
type Person = { id: string; email: string; name: string; locale: string; verified: boolean }

/** Where each kind's emailed links open. */
const pages = {
  member: { verify: "account/verify", reset: "account/reset" },
  instructor: { verify: "instructor/verify", reset: "instructor/reset" },
} as const

const link = (locale: string, page: string, token: string) => `/${locale}/${page}?token=${encodeURIComponent(token)}`

/** Links of a deactivated instructor never work (deactivating also deletes them; this is a second lock). */
const activeOnly = (kind: AccountKind) =>
  kind === "instructor"
    ? inArray(emailTokens.subjectId, db.select({ id: instructors.id }).from(instructors).where(eq(instructors.active, true)))
    : undefined

/** A member, or an active instructor (named in `nameLocale`, default: their own language). */
async function findPerson(
  kind: AccountKind,
  by: { id: string } | { email: string },
  nameLocale?: string,
): Promise<Person | null> {
  if (kind === "member") {
    const [row] = await db
      .select({
        id: members.id,
        email: members.email,
        name: members.name,
        locale: members.locale,
        verifiedAt: members.emailVerifiedAt,
      })
      .from(members)
      .where("id" in by ? eq(members.id, by.id) : eq(members.email, normalizeEmail(by.email)))
      .limit(1)
    return row ? { id: row.id, email: row.email, name: row.name, locale: row.locale, verified: row.verifiedAt !== null } : null
  }
  const [row] = await db
    .select({
      id: instructors.id,
      email: instructors.email,
      displayName: instructors.displayName,
      locale: instructors.locale,
      verifiedAt: instructors.emailVerifiedAt,
      active: instructors.active,
    })
    .from(instructors)
    // Instructor emails are unique regardless of case (older rows may not be lower-case).
    .where("id" in by ? eq(instructors.id, by.id) : sql`lower(${instructors.email}) = ${normalizeEmail(by.email)}`)
    .limit(1)
  if (!row?.active) return null
  return {
    id: row.id,
    email: row.email,
    name: profileText(row.displayName, nameLocale ?? row.locale),
    locale: row.locale,
    verified: row.verifiedAt !== null,
  }
}

const tokenQuery = (kind: AccountKind, purpose: TokenPurpose, now?: Date) => ({ kind, purpose, also: activeOnly(kind), now })

/**
 * After an emailed link set a password: store it, clear the lockout, mark the
 * email verified (the link proved the inbox), drop the person's other open
 * links and end every session (the caller signs this device in).
 */
async function setPassword(tx: Tx, kind: AccountKind, id: string, passwordHash: string, now: Date) {
  const at = now.toISOString()
  if (kind === "member") {
    await tx
      .update(members)
      .set({
        passwordHash,
        failedLogins: 0,
        lockedUntil: null,
        emailVerifiedAt: sql`coalesce(${members.emailVerifiedAt}, ${at}::timestamptz)`,
      })
      .where(eq(members.id, id))
  } else {
    await tx
      .update(instructors)
      .set({
        passwordHash,
        failedLogins: 0,
        lockedUntil: null,
        emailVerifiedAt: sql`coalesce(${instructors.emailVerifiedAt}, ${at}::timestamptz)`,
        updatedAt: sql`now()`,
      })
      .where(eq(instructors.id, id))
  }
  await tx.delete(emailTokens).where(unusedTokensOf(kind, id))
  await deleteSessionsOf(kind, id, tx)
}

// ─── Members: sign up, language ───────────────────────────────────────────────

export type SignUpInput = { name: string; email: string; password: string; phone: string; locale: string }

/**
 * Create a member account. Returns the new id, or null when the email already
 * has an account (nothing changes then). The password is hashed first either
 * way, so both answers take about the same time.
 */
export async function signUpMember(input: SignUpInput): Promise<string | null> {
  const passwordHash = await hashPassword(input.password)
  const [row] = await db
    .insert(members)
    .values({
      email: normalizeEmail(input.email),
      passwordHash,
      name: input.name,
      phone: input.phone || null,
      locale: input.locale,
    })
    .onConflictDoNothing({ target: members.email })
    .returning({ id: members.id })
  return row?.id ?? null
}

/**
 * Someone tried to sign up with the email of an existing member: tell that
 * member they can log in, or choose a new password. Nothing when there is no
 * such member.
 */
export async function sendMemberExists(email: string, locale: string): Promise<boolean> {
  const member = await findPerson("member", { email })
  if (!member) return false
  const sent = await sendEmail({
    to: member.email,
    template: "member_exists",
    locale,
    props: { name: member.name, loginUrl: `/${locale}/account/login`, resetUrl: `/${locale}/account/forgot` },
  })
  return sent.ok
}

/** The language of a member's emails (they switched the site's language). */
export async function setMemberLocale(memberId: string, locale: string) {
  await db.update(members).set({ locale }).where(eq(members.id, memberId))
}

/** The language of an instructor's emails and panel. */
export async function setInstructorLocale(instructorId: string, locale: string) {
  await db.update(instructors).set({ locale, updatedAt: sql`now()` }).where(eq(instructors.id, instructorId))
}

// ─── Verify email ─────────────────────────────────────────────────────────────

/**
 * Email a new verify link (24 hours; earlier ones stop working) in the
 * person's language. "verified" when there is nothing to verify.
 */
export async function sendVerifyLink(kind: AccountKind, id: string): Promise<"sent" | "verified" | "failed"> {
  const person = await findPerson(kind, { id })
  if (!person) return "failed"
  if (person.verified) return "verified"
  const token = await issueEmailToken(kind, "verify_email", id, TOKEN_TTL.verify_email)
  const sent = await sendEmail({
    to: person.email,
    template: "welcome_verify",
    locale: person.locale,
    props: { name: person.name, verifyUrl: link(person.locale, pages[kind].verify, token) },
  })
  return sent.ok ? "sent" : "failed"
}

/** Use a verify link: the email is verified. Returns the person's id, or null when the link no longer works. */
export async function verifyEmail(kind: AccountKind, token: unknown, now = new Date()): Promise<string | null> {
  if (!isTokenShaped(token)) return null
  return db.transaction(async (tx) => {
    const id = await consumeEmailToken(tx, token, tokenQuery(kind, "verify_email", now))
    if (!id) return null
    const at = sql`coalesce(email_verified_at, ${now.toISOString()}::timestamptz)`
    if (kind === "member") await tx.update(members).set({ emailVerifiedAt: at }).where(eq(members.id, id))
    else await tx.update(instructors).set({ emailVerifiedAt: at }).where(eq(instructors.id, id))
    return id
  })
}

// ─── Forgot / reset password ──────────────────────────────────────────────────

/**
 * "Forgot your password?": email a reset link (30 minutes) in `locale` when
 * the address belongs to a member (or an active instructor); otherwise do
 * nothing. Callers run it after the response, so the answer and its timing are
 * the same either way.
 */
export async function sendResetLink(kind: AccountKind, email: string, locale: string): Promise<boolean> {
  const person = await findPerson(kind, { email }, locale)
  if (!person) return false
  const token = await issueEmailToken(kind, "reset_password", person.id, TOKEN_TTL.reset_password)
  const sent = await sendEmail({
    to: person.email,
    template: "password_reset",
    locale,
    props: { name: person.name, resetUrl: link(locale, pages[kind].reset, token) },
  })
  return sent.ok
}

/** True when a reset link still works (the reset page checks this before showing the form). */
export async function isResetLinkValid(kind: AccountKind, token: unknown): Promise<boolean> {
  return (await peekEmailToken(token, tokenQuery(kind, "reset_password"))) !== null
}

/**
 * A new password from a reset link, in one transaction: uses the link, stores
 * the password and ends every session. Returns the person's id, or null when
 * the link no longer works.
 */
export async function resetPassword(
  kind: AccountKind,
  token: unknown,
  password: string,
  now = new Date(),
): Promise<string | null> {
  if (!isTokenShaped(token)) return null
  const passwordHash = await hashPassword(password) // before the transaction: Argon2 is slow
  return db.transaction(async (tx) => {
    const id = await consumeEmailToken(tx, token, tokenQuery(kind, "reset_password", now))
    if (id) await setPassword(tx, kind, id, passwordHash, now)
    return id
  })
}

// ─── Instructor invitation ────────────────────────────────────────────────────

/** Who an invitation link is for (the accept page greets them), or null when it no longer works. */
export async function inviteDetails(token: unknown, locale: string): Promise<{ name: string; email: string } | null> {
  const id = await peekEmailToken(token, tokenQuery("instructor", "invite"))
  const person = id && (await findPerson("instructor", { id }, locale))
  return person ? { name: person.name, email: person.email } : null
}

/**
 * Accept an invitation: in one transaction, use the link (unused, not
 * expired, active instructor), set the password, mark the email verified and
 * drop the other open links. Returns the instructor id, or null.
 */
export async function acceptInvite(token: unknown, password: string, now = new Date()): Promise<string | null> {
  if (!isTokenShaped(token)) return null
  const passwordHash = await hashPassword(password)
  return db.transaction(async (tx) => {
    const id = await consumeEmailToken(tx, token, tokenQuery("instructor", "invite", now))
    if (id) await setPassword(tx, "instructor", id, passwordHash, now)
    return id
  })
}
