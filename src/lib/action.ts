import "server-only"
import { headers } from "next/headers"
import { unstable_rethrow } from "next/navigation"
import { getTranslations } from "next-intl/server"
import type { z } from "zod"

import { audit, type AuditEntry } from "@/lib/audit"
import { requireAdmin, type AdminSession } from "@/lib/auth/admin"
import { requireInstructor, type InstructorSession } from "@/lib/auth/instructor"
import { requireMember, type MemberSession } from "@/lib/auth/member"
import { createRateLimiter, rateLimitClient } from "@/lib/auth/rate-limit"
import { clientIp } from "@/lib/auth/request"
import { UserError, errorForLog, isMessageKey, zodIssueMessage, type ActionResult, type MessageValues } from "@/lib/errors"
import type { Tx } from "@/db"

export type { ActionResult } from "@/lib/errors"
export { UserError } from "@/lib/errors"

export type AdminActionContext = AdminSession & {
  /** `audit()` with this admin as the actor. Pass the transaction handle when inside one. */
  audit: (entry: Omit<AuditEntry, "adminId">, tx?: Tx) => Promise<void>
}

/**
 * Define a super-admin server action. Use it for EVERY admin mutation:
 *
 *   "use server"
 *   export const createThing = adminAction(thingSchema, async (input, ctx) => { ... })
 *
 * It checks the session (redirects to the login when signed out), validates the
 * input (an object or FormData) with Zod, runs the handler and returns an
 * `ActionResult`: `{ ok: true, data }` or `{ ok: false, error, fieldErrors? }`
 * with friendly, translated text. Throw `UserError` for expected failures;
 * anything else is logged and shown as a generic message.
 */
export function adminAction<S extends z.ZodType, T = undefined>(
  schema: S,
  handler: (input: z.output<S>, ctx: AdminActionContext) => Promise<T>,
): (input: z.input<S> | FormData) => Promise<ActionResult<T>> {
  return async (input) => {
    const session = await requireAdmin()
    const ctx: AdminActionContext = {
      ...session,
      audit: (entry, tx) => audit({ ...entry, adminId: session.admin.id }, tx),
    }
    return runAction(schema, input, (data) => handler(data, ctx))
  }
}

/** `ctx.audit` of member and instructor actions (see `personAudit`). */
type PersonAudit = (entry: Omit<AuditEntry, "adminId">, tx?: Tx) => Promise<void>

export type MemberActionContext = MemberSession & {
  /** `audit()` as this member, or as the super admin viewing as them. Pass the transaction handle when inside one. */
  audit: PersonAudit
}

export type InstructorActionContext = InstructorSession & {
  /** `audit()` as this instructor, or as the super admin viewing as them. Pass the transaction handle when inside one. */
  audit: PersonAudit
}

/**
 * Audit an action of a member or instructor. Done by the person: no admin,
 * `data.by` = the kind. Done by a super admin viewing as them: `adminId` = that
 * admin (the "Who" of the audit page) and `data.impersonatedBy` = their id.
 */
function personAudit(by: "member" | "instructor", viewer: { id: string } | null | undefined): PersonAudit {
  return (entry, tx) =>
    audit(
      {
        ...entry,
        adminId: viewer?.id ?? null,
        data: { by, ...entry.data, ...(viewer ? { impersonatedBy: viewer.id } : {}) },
      },
      tx,
    )
}

/**
 * Options of `memberAction` / `instructorAction`.
 * - `notImpersonated`: refuse while a super admin views as the person
 *   (`common.errors.impersonationBlocked`): what only the person may do
 *   themselves, such as signing a contract, registering (accepting terms and
 *   consents), and any future change of their own password or email or
 *   deletion of the account.
 */
type PersonActionOptions = { notImpersonated?: boolean }

/**
 * A member (student) server action: like `adminAction`, with the signed-in
 * member as `ctx` (plus `ctx.audit`, which names the viewing admin when a super
 * admin views as the member). Signed out, it redirects to the member login,
 * which comes back to the page the action was posted from. Every query in the
 * handler must be scoped to `ctx.member.id` (never trust an id of another
 * person from the browser). `{ verified: true }` refuses members whose email is
 * not verified yet with a friendly message (registering and paying need it,
 * README §4); `{ notImpersonated: true }` refuses a super admin viewing as them.
 */
export function memberAction<S extends z.ZodType, T = undefined>(
  schema: S,
  handler: (input: z.output<S>, ctx: MemberActionContext) => Promise<T>,
  options: PersonActionOptions & { verified?: boolean } = {},
): (input: z.input<S> | FormData) => Promise<ActionResult<T>> {
  return async (input) => {
    const session = await requireMember()
    const ctx: MemberActionContext = { ...session, audit: personAudit("member", session.impersonatedBy) }
    return runAction(schema, input, async (data) => {
      if (options.notImpersonated && session.impersonatedBy) throw new UserError("common.errors.impersonationBlocked")
      if (options.verified && !session.member.emailVerified) throw new UserError("account.errors.unverified")
      return handler(data, ctx)
    })
  }
}

/**
 * An instructor panel server action: like `adminAction`, with the signed-in,
 * active instructor as `ctx` (plus `ctx.audit`, which names the viewing admin
 * when a super admin views as the instructor). Signed out (or deactivated), it
 * redirects to the instructor login. Scope every query to `ctx.instructor.id`.
 * `{ notImpersonated: true }` refuses a super admin viewing as them.
 */
export function instructorAction<S extends z.ZodType, T = undefined>(
  schema: S,
  handler: (input: z.output<S>, ctx: InstructorActionContext) => Promise<T>,
  options: PersonActionOptions = {},
): (input: z.input<S> | FormData) => Promise<ActionResult<T>> {
  return async (input) => {
    const session = await requireInstructor()
    const ctx: InstructorActionContext = { ...session, audit: personAudit("instructor", session.impersonatedBy) }
    return runAction(schema, input, async (data) => {
      if (options.notImpersonated && session.impersonatedBy) throw new UserError("common.errors.impersonationBlocked")
      return handler(data, ctx)
    })
  }
}

/**
 * A server action open to signed-out visitors (sign up, sign in, forgot
 * password, ...). `rateLimit` counts every call per client network (IPv4
 * address or IPv6 /64), before the input is even read; over the limit it
 * answers `rateLimitMessage` (default `auth.errors.rateLimited`). Each
 * `publicAction` has its own counter. Add per-account limits in the handler.
 */
export function publicAction<S extends z.ZodType, T = undefined>(
  schema: S,
  handler: (input: z.output<S>) => Promise<T>,
  options: { rateLimit?: { limit: number; windowMs: number }; rateLimitMessage?: string } = {},
): (input: z.input<S> | FormData) => Promise<ActionResult<T>> {
  const limiter = options.rateLimit && createRateLimiter(options.rateLimit)
  return async (input) => {
    if (limiter && !limiter.consume(rateLimitClient(clientIp(await headers()) ?? "unknown")).ok) {
      const t = await getTranslations()
      return { ok: false, error: t(options.rateLimitMessage ?? "auth.errors.rateLimited") }
    }
    return runAction(schema, input, handler)
  }
}

/**
 * The validation + error-mapping core of every action wrapper, without an
 * auth check. Prefer `adminAction`, `memberAction`, `instructorAction` or
 * `publicAction`.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  rawInput: unknown,
  run: (input: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  const t = await getTranslations()
  const translate = (key: string, values?: MessageValues) => (t.has(key) ? t(key, values) : t("common.errors.generic"))
  const common = (key: string, values?: MessageValues) => t(`common.${key}`, values)

  const input = rawInput instanceof FormData ? formDataToObject(rawInput) : rawInput
  const parsed = await schema.safeParseAsync(input, { error: (issue) => zodIssueMessage(issue, common) })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    let formError: string | undefined
    for (const issue of parsed.error.issues) {
      const message = isMessageKey(issue.message) ? translate(issue.message) : issue.message
      const path = issue.path.map(String).join(".")
      if (!path) formError ??= message
      else fieldErrors[path] ??= message
    }
    return { ok: false, error: formError ?? t("common.errors.invalidInput"), fieldErrors }
  }

  try {
    return { ok: true, data: await run(parsed.data) }
  } catch (err) {
    unstable_rethrow(err) // let redirect() / notFound() through
    if (err instanceof UserError) {
      const message = translate(err.key, err.values)
      return { ok: false, error: message, ...(err.field ? { fieldErrors: { [err.field]: message } } : {}) }
    }
    console.error("[action] unexpected error", errorForLog(err))
    return { ok: false, error: t("common.errors.generic") }
  }
}

/** FormData to a plain object. "name.fa" keys become nested objects; repeated keys become arrays. */
export function formDataToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of new Set(form.keys())) {
    if (key.startsWith("$ACTION")) continue // React's internal action fields
    const parts = key.split(".")
    if (parts.some((p) => !p || FORBIDDEN_KEYS.has(p))) continue
    const values = form.getAll(key)
    let target = out
    for (const part of parts.slice(0, -1)) {
      const next = target[part]
      target = (next && typeof next === "object" && !Array.isArray(next) ? next : (target[part] = {})) as Record<
        string,
        unknown
      >
    }
    target[parts[parts.length - 1]] = values.length > 1 ? values : values[0]
  }
  return out
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])
