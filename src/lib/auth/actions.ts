"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { after } from "next/server"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { adminAction, runAction, UserError, type ActionResult } from "@/lib/action"
import { audit } from "@/lib/audit"
import { errorForLog } from "@/lib/errors"
import { changeAdminPassword, resetAdminPassword, sendAdminResetLink } from "./account"
import { getAdmin } from "./admin"
import { LOCKOUT, normalizeEmail, verifyCredentials } from "./login"
import { createRateLimiter, loginRateLimiter, rateLimitClient } from "./rate-limit"
import { clientIp } from "./request"
import {
  changePasswordSchema,
  forgotPasswordSchema,
  PASSWORD_MAX_LENGTH,
  resetPasswordSchema,
} from "./schemas"
import { endSession, startSession } from "./session"

export type LoginState = { error?: string; email?: string }

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  next: z.string().max(300).optional(),
})

/** Only paths inside the admin panel of a known locale; anything else falls back to the dashboard. */
function safeNext(next: string | undefined, locale: string): string {
  if (next && /^\/(fa|tr|en)\/admin(\/[\w-]+)*$/.test(next) && !/\/admin\/login(\/|$)/.test(next)) return next
  return `/${locale}/admin`
}

/** Super-admin sign-in (`useActionState`). One generic message for every failure. */
export async function adminLoginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const t = await getTranslations("auth.login.errors")
  const invalid = () => t("invalid", { minutes: LOCKOUT.lockMs / 60_000 })
  const email = String(form.get("email") ?? "").trim().slice(0, 254)
  const parsed = loginSchema.safeParse({
    email: email.toLowerCase(),
    password: form.get("password"),
    next: form.get("next") || undefined,
  })
  if (!parsed.success) return { error: invalid(), email }

  const ip = clientIp(await headers()) ?? "unknown"
  if (!loginRateLimiter.consume(`admin:${rateLimitClient(ip)}`).ok) return { error: t("rateLimited"), email }

  const result = await verifyCredentials("admin", parsed.data.email, parsed.data.password)
  if (!result.ok) {
    if (result.lockedNow) {
      await audit({
        adminId: null,
        action: "auth.lockout",
        entity: "admin",
        entityId: result.id,
        data: { failures: LOCKOUT.maxFailures, minutes: LOCKOUT.lockMs / 60_000 },
      })
    }
    return { error: invalid(), email }
  }

  await startSession("admin", result.id)
  await audit({ adminId: result.id, action: "auth.login", entity: "admin", entityId: result.id })
  redirect(safeNext(parsed.data.next, await getLocale()))
}

/** Sign out: deletes the session row and cookie, then goes to the login page. */
export async function adminLogoutAction(): Promise<void> {
  const session = await getAdmin()
  await endSession("admin")
  if (session) {
    await audit({ adminId: session.admin.id, action: "auth.logout", entity: "admin", entityId: session.admin.id })
  }
  redirect(`/${await getLocale()}/admin/login`)
}

// ─── Password change and reset ────────────────────────────────────────────────

const FIFTEEN_MINUTES = 15 * 60_000
/** Each try checks a password: 5 per admin per 15 minutes. */
const passwordChangeLimiter = createRateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES })
/** "Forgot your password?" and the reset form: per client network and per email address. */
const passwordResetLimiter = createRateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES })

const requestNetwork = async () => rateLimitClient(clientIp(await headers()) ?? "unknown")

/**
 * Signed-in admin changes the password (user menu). Needs the current
 * password; ends every other session and keeps this device signed in.
 */
export const changeAdminPasswordAction = adminAction(changePasswordSchema, async ({ current, next }, ctx) => {
  if (!passwordChangeLimiter.consume(ctx.admin.id).ok) throw new UserError("auth.password.errors.rateLimited")
  if (!(await changeAdminPassword(ctx.admin.id, current, next))) {
    throw new UserError("auth.password.errors.wrongCurrent", { field: "current" })
  }
  await startSession("admin", ctx.admin.id)
})

/**
 * "Forgot your password?". Always the same answer, in the same time: the
 * admin lookup, the token and the email happen after the response.
 */
export async function requestAdminPasswordResetAction(
  input: z.input<typeof forgotPasswordSchema>,
): Promise<ActionResult<void>> {
  return runAction(forgotPasswordSchema, input, async ({ email }) => {
    if (!passwordResetLimiter.consume(`ip:${await requestNetwork()}`).ok) {
      throw new UserError("auth.forgot.errors.rateLimited")
    }
    const address = normalizeEmail(email)
    // Over the per-address limit: answer the same, send nothing.
    if (!passwordResetLimiter.consume(`email:${address}`).ok) return
    const locale = await getLocale()
    after(() =>
      sendAdminResetLink(address, locale).catch((err) =>
        console.error("[auth] password reset link failed", errorForLog(err)),
      ),
    )
  })
}

/** The reset page: a new password from a valid link, then back to the sign-in page. */
export async function resetAdminPasswordAction(
  input: z.input<typeof resetPasswordSchema>,
): Promise<ActionResult<void>> {
  return runAction(resetPasswordSchema, input, async ({ token, next }) => {
    if (!passwordResetLimiter.consume(`ip:${await requestNetwork()}`).ok) {
      throw new UserError("auth.reset.errors.rateLimited")
    }
    if (!(await resetAdminPassword(token, next))) throw new UserError("auth.reset.errors.invalidLink")
    redirect(`/${await getLocale()}/admin/login?reset=done`)
  })
}
