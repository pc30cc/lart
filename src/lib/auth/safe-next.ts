/**
 * Where to go after signing in ("next"): only a page of this site that the
 * person may go back to, never another origin. Pure, no server-only import
 * (the forms may use it too).
 *
 * The value is parsed like a browser would (so "/fa/%2e%2e/admin", "/\t/evil"
 * or "//evil" cannot sneak through), then its path without the language is
 * looked up in the route table (lib/routes): the main language's pages have
 * no prefix, the others have /fa or /en in front. The normalised path is
 * returned.
 */
import { splitLocale } from "@/i18n/paths"
import { matchRoute } from "@/lib/routes"

const BASE = "http://next.invalid"

/**
 * member: a page of the public site or the member's own private pages (not
 * the sign-in pages: going "next" to one of them would loop), never a panel;
 * instructor: a private page of the instructor panel; admin: a private page of
 * the admin panel, path only.
 */
export type NextScope = "member" | "instructor" | "admin"

/** The path and query of a same-site link, or null for anything else. */
function sameSite(next: unknown): { pathname: string; search: string } | null {
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
  return { pathname: url.pathname, search: url.search }
}

/** A safe "next" for the scope (see `NextScope`), else `fallback`. */
export function safeNext(next: unknown, scope: NextScope, fallback: string): string {
  const url = sameSite(next)
  if (!url) return fallback
  const route = matchRoute(splitLocale(url.pathname).rest)
  if (!route || route.kind !== "page") return fallback
  const allowed =
    scope === "member"
      ? route.area === "site" || (route.area === "account" && route.access === "private")
      : scope === "instructor"
        ? route.area === "instructor" && route.access === "private"
        : route.area === "admin" && route.access === "private" && url.search === ""
  return allowed ? url.pathname + url.search : fallback
}
