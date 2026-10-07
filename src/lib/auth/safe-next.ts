/**
 * Where to go after signing in ("next"): only a path on this site, never
 * another origin. No server-only import (pure; the forms may use it too).
 *
 * The value is parsed like a browser would (so "/tr/%2e%2e/admin", "/\t/evil"
 * or "//evil" cannot sneak through) and the normalised path is returned.
 */

const BASE = "http://next.invalid"
/** The end of a path segment: a slash, the query, or the end. */
const END = String.raw`(?:[/?]|$)`
const LOCALE_PATH = new RegExp(String.raw`^/(fa|tr|en)${END}`)
/** Member sign-in pages: going "next" to one of them would loop. */
const ACCOUNT_AUTH = new RegExp(String.raw`^/(fa|tr|en)/account/(?:login|signup|verify|forgot|reset)${END}`)
const PANELS = new RegExp(String.raw`^/(fa|tr|en)/(?:admin|instructor)${END}`)
const INSTRUCTOR = new RegExp(String.raw`^/(fa|tr|en)/instructor${END}`)
const INSTRUCTOR_AUTH = new RegExp(String.raw`^/(fa|tr|en)/instructor/(?:login|accept-invite|verify|forgot|reset)${END}`)

export type NextScope = "member" | "instructor"

/** The path and query of a same-site link, or null for anything else. */
function sameSite(next: unknown): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > 300) return null
  // Must be a plain absolute path: no scheme, no "//host", no backslashes, no control characters.
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(next)) return null
  let url: URL
  try {
    url = new URL(next, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE) return null
  return url.pathname + url.search
}

/**
 * A safe "next" for a member (any page of the public site in a language,
 * except the sign-in pages and the panels) or an instructor (a page of the
 * instructor panel), else `fallback`.
 */
export function safeNext(next: unknown, scope: NextScope, fallback: string): string {
  const path = sameSite(next)
  if (!path || !LOCALE_PATH.test(path)) return fallback
  if (scope === "member") return PANELS.test(path) || ACCOUNT_AUTH.test(path) ? fallback : path
  return INSTRUCTOR.test(path) && !INSTRUCTOR_AUTH.test(path) ? path : fallback
}
