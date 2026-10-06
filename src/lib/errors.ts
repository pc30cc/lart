/**
 * Error helpers shared by server actions and client forms. No server-only
 * imports: client components use `zodIssueMessage` and the `ActionResult` type.
 */
import type { $ZodRawIssue } from "zod/v4/core"

/** What every server action returns. `error` and `fieldErrors` are already translated. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export type MessageValues = Record<string, string | number>

/**
 * An expected, user-facing failure ("this slug is taken"). `key` is a full
 * message key like "categories.errors.slugTaken"; `field` attaches the message
 * to a form field (dotted path, e.g. "name.tr").
 */
export class UserError extends Error {
  readonly key: string
  readonly values?: MessageValues
  readonly field?: string

  constructor(key: string, options: { values?: MessageValues; field?: string } = {}) {
    super(key)
    this.name = "UserError"
    this.key = key
    this.values = options.values
    this.field = options.field
  }
}

/** PostgreSQL error codes worth mapping to friendly messages. */
export const PG = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
} as const

/** The PostgreSQL error inside a (possibly wrapped) Drizzle error, or null. */
export function pgError(err: unknown): { code: string; constraint?: string } | null {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown }
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
      return { code: e.code, constraint: typeof e.constraint === "string" ? e.constraint : undefined }
    }
    current = e.cause
  }
  return null
}

type PgFields = { code?: unknown; constraint?: unknown; table?: unknown; column?: unknown; cause?: unknown }

/** Drizzle's `DrizzleQueryError` ("Failed query: <sql>\nparams: <values>"), recognised by shape (no drizzle import here). */
const isQueryError = (err: unknown): err is Error & { query: string; params: unknown } =>
  err instanceof Error && typeof (err as { query?: unknown }).query === "string" && "params" in err

/** Only the "at …" frames: the first lines of a stack repeat the message, which may hold values. */
const stackFrames = (err: Error) =>
  err.stack
    ?.split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n")

/** A PostgreSQL message without a trailing quoted value (`invalid input syntax for type uuid: "…"`). */
const safePgMessage = (message: unknown) =>
  typeof message === "string" ? message.replace(/: "[\s\S]*"$/, ': "…"').slice(0, 300) : undefined

/**
 * A log-safe summary of an unexpected error: the SQL text and PostgreSQL
 * code / constraint / table / column, never bound values or PostgreSQL's
 * `detail` (which repeats the values, e.g. `Key (email)=(…)`).
 */
export function errorForLog(err: unknown): Record<string, unknown> {
  let pg: (Error & PgFields) | undefined
  for (let current = err, depth = 0; current instanceof Error && depth < 5; depth++) {
    const code = (current as PgFields).code
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      pg = current as Error & PgFields
      break
    }
    current = (current as PgFields).cause
  }
  const pgInfo = pg && {
    code: pg.code,
    constraint: typeof pg.constraint === "string" ? pg.constraint : undefined,
    table: typeof pg.table === "string" ? pg.table : undefined,
    column: typeof pg.column === "string" ? pg.column : undefined,
  }
  if (isQueryError(err)) {
    const cause = err.cause instanceof Error ? err.cause : undefined
    return {
      kind: "query",
      query: err.query,
      ...pgInfo,
      cause: cause && (pg === cause ? safePgMessage(cause.message) : cause.name),
      stack: stackFrames(err),
    }
  }
  if (err instanceof Error) {
    return {
      name: err.name,
      message: pg === err ? safePgMessage(err.message) : err.message,
      ...pgInfo,
      stack: pg === err ? stackFrames(err) : err.stack,
    }
  }
  return { value: typeof err }
}

/** A translator for the "common" namespace (server `getTranslations` or client `useTranslations`). */
export type CommonTranslate = (key: string, values?: MessageValues) => string

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "")

/**
 * Turn a Zod issue into a friendly, translated message (keys under
 * `common.validation`). Pass it as the per-parse `error` map, on the server
 * and in the client resolver, so both sides say the same thing. Messages set
 * explicitly on a schema take precedence and should be full message keys.
 */
export function zodIssueMessage(issue: $ZodRawIssue, t: CommonTranslate): string {
  switch (issue.code) {
    case "invalid_type":
      if (isEmpty(issue.input)) return t("validation.required")
      if (issue.expected === "int") return t("validation.integer")
      return issue.expected === "number" ? t("validation.number") : t("validation.invalid")
    case "too_small": {
      const min = Number(issue.minimum)
      if (issue.origin === "string") return min <= 1 ? t("validation.required") : t("validation.tooShort", { min })
      if (issue.origin === "array" || issue.origin === "set") return t("validation.required")
      if (issue.origin === "number" || issue.origin === "int") return t("validation.tooSmall", { min })
      return t("validation.invalid")
    }
    case "too_big": {
      const max = Number(issue.maximum)
      if (issue.origin === "string") return t("validation.tooLong", { max })
      if (issue.origin === "number" || issue.origin === "int") return t("validation.tooBig", { max })
      return t("validation.invalid")
    }
    case "invalid_format":
      if (issue.format === "email") return t("validation.email")
      if (issue.format === "url") return t("validation.url")
      if (issue.format === "datetime" || issue.format === "date") return t("validation.date")
      if (issue.format === "time") return t("validation.time")
      return isEmpty(issue.input) ? t("validation.required") : t("validation.invalid")
    case "not_multiple_of":
      return t("validation.integer")
    case "invalid_value":
      return isEmpty(issue.input) ? t("validation.required") : t("validation.choose")
    default:
      return isEmpty(issue.input) ? t("validation.required") : t("validation.invalid")
  }
}

/** Looks like a message key ("ns.some.key"), as opposed to ready text. */
export const isMessageKey = (s: string) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(s)
