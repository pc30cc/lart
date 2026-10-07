"use server"

import { redirect } from "next/navigation"
import { after } from "next/server"
import { getLocale } from "next-intl/server"
import { z } from "zod"

import { instructorAction, memberAction, publicAction, UserError } from "@/lib/action"
import { getMember } from "@/lib/auth/member"
import { LOCKOUT, verifyCredentials } from "@/lib/auth/login"
import { createRateLimiter } from "@/lib/auth/rate-limit"
import { safeNext } from "@/lib/auth/safe-next"
import { endSession, startSession } from "@/lib/auth/session"
import { errorForLog } from "@/lib/errors"
import {
  acceptInvite,
  resetPassword,
  sendMemberExists,
  sendResetLink,
  sendVerifyLink,
  setInstructorLocale,
  setMemberLocale,
  signUpMember,
  type AccountKind,
} from "./accounts"
import { accountForgotSchema, accountLocaleSchema, accountLoginSchema, accountPasswordSchema, signupSchema } from "./schema"

/**
 * Sign-up, sign-in, links and language for members (students, on the site)
 * and instructors (their panel). Every answer is friendly and the same for
 * known and unknown addresses (no user enumeration).
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
const workshopsPath = (locale: string) => `/${locale}/workshops`
const panelPath = (locale: string) => `/${locale}/instructor`

// ─── Members ──────────────────────────────────────────────────────────────────

/**
 * Sign up, then straight back to the site. A new account is signed in and gets
 * the welcome + verify email. An email that already has an account gets a
 * "you already have an account" email instead, and the answer is the same
 * ("check your inbox", then continue to `next`).
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
    return { next: safeNext(next, "member", workshopsPath(locale)) }
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
    redirect(safeNext(next, "member", workshopsPath(await getLocale())))
  },
  perNetwork(10, 15),
)

/** Sign out, then the workshops list. */
export async function memberLogoutAction(): Promise<void> {
  await endSession("member")
  redirect(workshopsPath(await getLocale()))
}

/** The banner's "Send it again". */
export const resendMemberVerifyAction = memberAction(z.object({}), async (_input, ctx) => resend("member", ctx.member.id))

/** "Forgot your password?" for members: always the same answer, in the same time. */
export const requestMemberResetAction = publicAction(
  accountForgotSchema,
  async ({ email }) => requestReset("member", email),
  perNetwork(5, 15),
)

/**
 * A new password from the emailed link. Every other session ends and this
 * device is signed in; the page then says so and offers the way back (`next`).
 */
export const resetMemberPasswordAction = publicAction(
  accountPasswordSchema,
  async ({ token, password }) => {
    const id = await resetPassword("member", token, password)
    if (!id) throw new UserError("account.reset.errors.invalidLink")
    await startSession("member", id)
    return { next: workshopsPath(await getLocale()) }
  },
  perNetwork(10, 15),
)

/**
 * The site's language switch: a signed-in member's emails follow the language
 * they chose. Signed out it does nothing (never redirects).
 */
export const setMemberLocaleAction = publicAction(accountLocaleSchema, async ({ locale }) => {
  const session = await getMember()
  if (session && session.member.locale !== locale) await setMemberLocale(session.member.id, locale)
})

// ─── Instructors ──────────────────────────────────────────────────────────────

/** Instructor sign-in (deactivated instructors cannot). Into the panel, or back to `next` inside it. */
export const instructorLoginAction = publicAction(
  accountLoginSchema,
  async ({ email, password, next }) => {
    const result = await verifyCredentials("instructor", email, password)
    if (!result.ok) {
      throw new UserError("auth.instructor.login.errors.invalid", { values: { minutes: LOCKOUT.lockMs / MINUTE } })
    }
    await startSession("instructor", result.id)
    redirect(safeNext(next, "instructor", panelPath(await getLocale())))
  },
  perNetwork(10, 15),
)

/** Sign out, then the instructor sign-in page. */
export async function instructorLogoutAction(): Promise<void> {
  await endSession("instructor")
  redirect(`${panelPath(await getLocale())}/login`)
}

/** The invitation link's page: choose a password, then straight into the panel. */
export const acceptInviteAction = publicAction(
  accountPasswordSchema,
  async ({ token, password }) => {
    const id = await acceptInvite(token, password)
    if (!id) throw new UserError("auth.instructor.invite.errors.invalidLink")
    await startSession("instructor", id)
    redirect(panelPath(await getLocale()))
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
    redirect(panelPath(await getLocale()))
  },
  perNetwork(10, 15),
)

/** The panel's "Please confirm your email" banner: "Send it again". */
export const resendInstructorVerifyAction = instructorAction(z.object({}), async (_input, ctx) =>
  resend("instructor", ctx.instructor.id),
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
  return { verified: result === "verified" }
}
