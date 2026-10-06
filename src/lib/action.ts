import "server-only"
import { unstable_rethrow } from "next/navigation"
import { getTranslations } from "next-intl/server"
import type { z } from "zod"

import { audit, type AuditEntry } from "@/lib/audit"
import { requireAdmin, type AdminSession } from "@/lib/auth/admin"
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

/**
 * The validation + error-mapping core of `adminAction`, without the auth check.
 * Phase 2 builds `instructorAction` / `memberAction` on it after their own check.
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
