"use server"

import { refresh } from "next/cache"
import { redirect } from "next/navigation"
import { after } from "next/server"
import { getLocale } from "next-intl/server"
import { z } from "zod"

import { localeHref } from "@/i18n/links"
import { instructorAction, memberAction, publicAction, UserError } from "@/lib/action"
import { getMember } from "@/lib/auth/member"
import { LOCKOUT, verifyCredentials } from "@/lib/auth/login"
import { createRateLimiter } from "@/lib/auth/rate-limit"
import { safeNext } from "@/lib/auth/safe-next"
import { endSession, startSession } from "@/lib/auth/session"
import { sendInstructorSignup } from "@/features/instructors/notify"
import { errorForLog } from "@/lib/errors"
import {
  acceptInvite,
  resetPassword,
  sendMemberExists,
  sendResetLink,
  sendVerifyLink,
  setInstructorLocale,
  setMemberLocale,
  signUpInstructor,
  signUpMember,
  verifyEmail,
  type AccountKind,
} from "./accounts"
import {
  accountForgotSchema,
  accountLocaleSchema,
  accountLoginSchema,
  accountPasswordSchema,
  accountTokenSchema,
  instructorSignupSchema,
  signupSchema,
  withNotice,
} from "./schema"

/**
 * Sign-up, sign-in, emailed links and language for members (students, on the
 * site) and instructors (their panel). Every answer is friendly and the same
 * for known and unknown addresses (no user enumeration). Actions that change
 * the session cookie end with a redirect, so the page they lead to is rendered
 * with the new session in the same round trip.
 */

const MINUTE = 60_000
const perNetwork = (limit: number, minutes: number) => ({ rateLimit: { limit, windowMs: minutes * MINUTE } })
/** "Tell the owner someone tried to sign up with their email": at most 3 emails per address per hour. */
const existsEmailLimiter = createRateLimiter({ limit: 3, windowMs: 60 * MINUTE })
/** Reset links: at most 5 per address per 15 minutes (per kind). */
const resetEmailLimiter = createRateLimiter({ limit: 5, windowMs: 15 * MINUTE })
/** "Send the confirmation email again": 3 per person per 15 minutes. */
const resendLimiter = createRateLimiter({ limit: 3, windowMs: 15 * MINUTE })

const logFailure = (what: string) => (err: unknown) => console.error(`[accounts] ${what} failed`, errorForLog(err))

/** The site's workshops list: where members land by default. */
const workshopsPath = (locale: string) => localeHref(locale, "/workshops")
const panelPath = (locale: string) => localeHref(locale, "/instructor")

// ─── Members ──────────────────────────────────────────────────────────────────

/**
 * Sign up, then straight back to the site (`next`, or the workshops), where a
 * "check your inbox" notice shows. A new account is signed in and gets the
 * welcome + verify email. An email that already has an account gets a "you
 * already have an account" email instead, and the answer is the same.
 */
export const memberSignupAction = publicAction(
  signupSchema,
  async ({ next, ...input }) => {
    const locale = await getLocale()
    const id = await signUpMember({ ...input, locale })
    if (id) {
      await startSession("member", id)
      after(() => sendVerifyLink("member", id).catch(logFailure("welcome email")))
    } else if (existsEmailLimiter.consume(input.email).ok) {
      after(() => sendMemberExists(input.email, locale).catch(logFailure("member exists email")))
    }
    redirect(withNotice(safeNext(next, "member", await workshopsPath(locale)), "checkEmail"))
  },
  perNetwork(10, 60),
)

/** Member sign-in. One generic message for every failure; back to `next` or the workshops. */
export const memberLoginAction = publicAction(
  accountLoginSchema,
  async ({ email, password, next }) => {
    const result = await verifyCredentials("member", email, password)
    if (!result.ok) throw new UserError("account.login.errors.invalid", { values: { minutes: LOCKOUT.lockMs / MINUTE } })
    await startSession("member", result.id)
    redirect(safeNext(next, "member", await workshopsPath(await getLocale())))
  },
  perNetwork(10, 15),
)

/** Sign out, then the workshops list with a short "you're signed out" notice. */
export async function memberLogoutAction(): Promise<void> {
  await endSession("member")
  redirect(withNotice(await workshopsPath(await getLocale()), "signedOut"))
}

/** The banner's "Send it again". `{ verified: true }` when there is nothing to send. */
export const resendMemberVerifyAction = memberAction(z.object({}), async (_input, ctx) => resend("member", ctx.member.id))

/** The link from the welcome email (signed in or not; it never signs anyone in). */
export const verifyMemberEmailAction = publicAction(
  accountTokenSchema,
  async ({ token }) => confirmEmail("member", token),
  perNetwork(20, 15),
)

/** "Forgot your password?" for members: always the same answer, in the same time. */
export const requestMemberResetAction = publicAction(
  accountForgotSchema,
  async ({ email }) => requestReset("member", email),
  perNetwork(5, 15),
)

/**
 * A new password from the emailed link. Every other session ends and this
 * device is signed in, then the workshops list says "your new password is saved".
 */
export const resetMemberPasswordAction = publicAction(
  accountPasswordSchema,
  async ({ token, password }) => {
    const id = await resetPassword("member", token, password)
    if (!id) throw new UserError("account.reset.errors.invalidLink")
    await startSession("member", id)
    redirect(withNotice(await workshopsPath(await getLocale()), "passwordSaved"))
  },
  perNetwork(10, 15),
)

/**
 * The site's language switch: a signed-in member's emails follow the language
 * they chose (members.locale). Signed out it does nothing (never redirects).
 */
export const setMemberLocaleAction = publicAction(
  accountLocaleSchema,
  async ({ locale }) => {
    const session = await getMember()
    if (session && session.member.locale !== locale) await setMemberLocale(session.member.id, locale)
  },
  perNetwork(30, 15),
)

// ─── Instructors ──────────────────────────────────────────────────────────────

/**
 * An instructor's own sign-up (the page is not linked from the site; the team
 * shares its address). The new account is signed in and opens the panel,
 * where a banner says it waits for the team's approval; the instructor gets
 * the welcome + verify email, every admin a "new instructor" email. An email
 * that already has an instructor account is refused with a pointer to sign in.
 */
export const instructorSignupAction = publicAction(
  instructorSignupSchema,
  async (input) => {
    const locale = await getLocale()
    const { displayName, teachingField, bio, teachingLanguages, website, officialName, mobile, email, password } = input
    const id = await signUpInstructor({
      displayName,
      teachingField,
      bio,
      teachingLanguages,
      website,
      officialName,
      mobile,
      email,
      password,
      idNumber: input.idNumber ?? "",
      locale,
    })
    if (!id) throw new UserError("auth.instructor.signup.errors.emailTaken", { field: "email" })
    await startSession("instructor", id)
    after(async () => {
      await sendVerifyLink("instructor", id).catch(logFailure("instructor welcome email"))
      await sendInstructorSignup(id).catch(logFailure("new instructor email"))
    })
    redirect(await panelPath(locale))
  },
  perNetwork(5, 60),
)

/** Instructor sign-in (deactivated instructors cannot). Into the panel, or back to `next` inside it. */
export const instructorLoginAction = publicAction(
  accountLoginSchema,
  async ({ email, password, next }) => {
    const result = await verifyCredentials("instructor", email, password)
    if (!result.ok) {
      throw new UserError("auth.instructor.login.errors.invalid", { values: { minutes: LOCKOUT.lockMs / MINUTE } })
    }
    await startSession("instructor", result.id)
    redirect(safeNext(next, "instructor", await panelPath(await getLocale())))
  },
  perNetwork(10, 15),
)

/** Sign out, then the instructor sign-in page ("you're signed out"). */
export async function instructorLogoutAction(): Promise<void> {
  await endSession("instructor")
  redirect(withNotice(await localeHref(await getLocale(), "/instructor/login"), "signedOut"))
}

/** The invitation link's page: choose a password, then straight into the panel. */
export const acceptInviteAction = publicAction(
  accountPasswordSchema,
  async ({ token, password }) => {
    // The invitation page's language becomes the instructor's (emails, panel).
    const locale = await getLocale()
    const id = await acceptInvite(token, password, locale)
    if (!id) throw new UserError("auth.instructor.invite.errors.invalidLink")
    await startSession("instructor", id)
    redirect(await panelPath(locale))
  },
  perNetwork(10, 15),
)

/** "Forgot your password?" for instructors. */
export const requestInstructorResetAction = publicAction(
  accountForgotSchema,
  async ({ email }) => requestReset("instructor", email),
  perNetwork(5, 15),
)

/** A new password from the emailed link; signs this device in and opens the panel. */
export const resetInstructorPasswordAction = publicAction(
  accountPasswordSchema,
  async ({ token, password }) => {
    const id = await resetPassword("instructor", token, password)
    if (!id) throw new UserError("auth.instructor.reset.errors.invalidLink")
    await startSession("instructor", id)
    redirect(await panelPath(await getLocale()))
  },
  perNetwork(10, 15),
)

/** The panel's "Please confirm your email" banner: "Send it again". */
export const resendInstructorVerifyAction = instructorAction(z.object({}), async (_input, ctx) =>
  resend("instructor", ctx.instructor.id),
)

/** The link from the instructor's verify email (`/<locale>/instructor/verify`). */
export const verifyInstructorEmailAction = publicAction(
  accountTokenSchema,
  async ({ token }) => confirmEmail("instructor", token),
  perNetwork(20, 15),
)

/** The language of the instructor's emails and panel. */
export const setInstructorLocaleAction = instructorAction(accountLocaleSchema, async ({ locale }, ctx) => {
  if (ctx.instructor.locale !== locale) await setInstructorLocale(ctx.instructor.id, locale)
})

// ─── Shared ───────────────────────────────────────────────────────────────────

async function requestReset(kind: AccountKind, email: string): Promise<void> {
  // Over the per-address limit: the same answer, nothing sent.
  if (!resetEmailLimiter.consume(`${kind}:${email}`).ok) return
  const locale = await getLocale()
  after(() => sendResetLink(kind, email, locale).catch(logFailure("reset link")))
}

/** `{ verified: true }` when there was nothing to send (the page then drops the banner). */
async function resend(kind: AccountKind, id: string): Promise<{ verified: boolean }> {
  if (!resendLimiter.consume(`${kind}:${id}`).ok) throw new UserError("account.verify.errors.rateLimited")
  const result = await sendVerifyLink(kind, id)
  if (result === "failed") throw new UserError("account.verify.errors.notSent")
  if (result === "verified") refresh()
  return { verified: result === "verified" }
}

/** Use a verify link; re-renders the page, so the "Please confirm your email" banner goes away. */
async function confirmEmail(kind: AccountKind, token: string): Promise<void> {
  if (!(await verifyEmail(kind, token))) throw new UserError("account.verify.errors.invalidLink")
  refresh()
}
