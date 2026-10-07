/**
 * Where to go after signing in ("next"): only a page of this site that the
 * person may go back to, never another origin. Pure, no server-only import
 * (the forms may use it too).
 *
 * The value is parsed like a browser would (so "/fa/%2e%2e/admin", "/\t/evil"
 * or "//evil" cannot sneak through), then its path without the language is
 * looked up in the route table (lib/routes). The address is then written
 * again by the URL rules (docs/DEVELOPMENT.md): the main language's pages
 * without a prefix, the others with /fa or /en in front, in lower case, no
 * trailing slash. So an old "/tr/workshops" (tr being the main language) or
 * "/FA/workshops" leads straight to "/workshops" or "/fa/workshops", never
 * through a second redirect.
 */
import type { AppLocale } from "@/i18n/locales"
import { localePath, splitLocale } from "@/i18n/paths"
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

/**
 * A safe "next" for the scope (see `NextScope`), at its address today, else
 * `fallback`. `main` is the main language (on the server: `await mainLocale()`).
 */
export function safeNext(next: unknown, scope: NextScope, fallback: string, main: AppLocale): string {
  const url = sameSite(next)
  if (!url) return fallback
  const { locale, rest } = splitLocale(url.pathname)
  const route = matchRoute(rest)
  if (!route || route.kind !== "page") return fallback
  const allowed =
    scope === "member"
      ? route.area === "site" || (route.area === "account" && route.access === "private")
      : scope === "instructor"
        ? route.area === "instructor" && route.access === "private"
        : route.area === "admin" && route.access === "private" && url.search === ""
  if (!allowed) return fallback
  // Repeated slashes merged and no trailing slash, like the router does.
  const path = rest.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1")
  return localePath(locale ?? main, path, main) + url.search
}
