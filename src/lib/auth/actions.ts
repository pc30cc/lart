"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { audit } from "@/lib/audit"
import { getAdmin } from "./admin"
import { LOCKOUT, verifyCredentials } from "./login"
import { PASSWORD_MAX_LENGTH } from "./password"
import { loginRateLimiter } from "./rate-limit"
import { clientIp } from "./request"
import { endSession, startSession } from "./session"

export type LoginState = { error?: string; email?: string }

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  next: z.string().max(300).optional(),
})

/** Only paths inside the admin panel of a known locale; anything else falls back to the dashboard. */
function safeNext(next: string | undefined, locale: string): string {
  if (next && /^\/(fa|tr|en)\/admin(\/[\w-]+)*$/.test(next) && !/\/admin\/login$/.test(next)) return next
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
  if (!loginRateLimiter.consume(`admin:${ip}`).ok) return { error: t("rateLimited"), email }

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
