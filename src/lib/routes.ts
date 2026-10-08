import { localePath, splitLocale } from "@/i18n/paths"
import type { AppLocale } from "@/i18n/locales"

/**
 * Every address of the site, in one list (docs/DEVELOPMENT.md, "URL rules",
 * mirrors it row by row). The proxy's open sign-in pages, `safeNext` and the
 * guard test (routes.test.ts: the pages on disk must equal this list, and the
 * paths must follow the rules) all read it. Pure: no server-only import.
 *
 * Paths are written without a language: in the main language that is the
 * address; the other languages put "/fa" or "/en" in front ("/" → "/fa").
 */

/** `site`: the public site; the other three are the private areas, each with its own sign-in. */
export type Area = "site" | "account" | "instructor" | "admin"
/** `public`: anyone, indexed; `open`: a sign-in page of an area (no session needed, noindex); `private`: needs the area's session. */
export type Access = "public" | "open" | "private"
/** `page`: a page.tsx; `handler`: a localized route.ts; `not-found`: the catch-all that shows the not-found page. */
export type RouteKind = "page" | "handler" | "not-found"
export type RouteEntry = { path: string; area: Area; access: Access; kind: RouteKind }

const table: [path: string, area: Area, access: Access, kind?: RouteKind][] = [
  // The public site
  ["/", "site", "public"],
  ["/workshops", "site", "public"],
  ["/workshops/[slug]", "site", "public"],
  ["/workshops/[slug]/register", "site", "public"],
  ["/about", "site", "public"],
  ["/story", "site", "public"],
  ["/[...rest]", "site", "public", "not-found"],
  // Students
  ["/account", "account", "private"],
  ["/account/login", "account", "open"],
  ["/account/signup", "account", "open"],
  ["/account/verify", "account", "open"],
  ["/account/forgot", "account", "open"],
  ["/account/reset", "account", "open"],
  ["/account/registrations/[id]", "account", "private"],
  // Instructors
  ["/instructor/login", "instructor", "open"],
  ["/instructor/signup", "instructor", "open"],
  ["/instructor/verify", "instructor", "open"],
  ["/instructor/forgot", "instructor", "open"],
  ["/instructor/reset", "instructor", "open"],
  ["/instructor/invite", "instructor", "open"],
  ["/instructor", "instructor", "private"],
  ["/instructor/contracts", "instructor", "private"],
  ["/instructor/contracts/[id]", "instructor", "private"],
  ["/instructor/workshops", "instructor", "private"],
  ["/instructor/workshops/[id]", "instructor", "private"],
  ["/instructor/earnings", "instructor", "private"],
  ["/instructor/profile", "instructor", "private"],
  ["/instructor/[...rest]", "instructor", "private", "not-found"],
  // Super admins
  ["/admin/login", "admin", "open"],
  ["/admin/forgot", "admin", "open"],
  ["/admin/reset", "admin", "open"],
  ["/admin/invite", "admin", "open"],
  ["/admin", "admin", "private"],
  ["/admin/audit", "admin", "private"],
  ["/admin/categories", "admin", "private"],
  ["/admin/categories/new", "admin", "private"],
  ["/admin/categories/[id]", "admin", "private"],
  ["/admin/instructors", "admin", "private"],
  ["/admin/instructors/new", "admin", "private"],
  ["/admin/instructors/[id]", "admin", "private"],
  ["/admin/instructors/[id]/edit", "admin", "private"],
  ["/admin/money", "admin", "private"],
  ["/admin/money/partners", "admin", "private"],
  ["/admin/money/refunds", "admin", "private"],
  ["/admin/money/reports", "admin", "private"],
  ["/admin/money/transactions", "admin", "private"],
  ["/admin/profile", "admin", "private"],
  ["/admin/registrations", "admin", "private"],
  ["/admin/settings", "admin", "private"],
  ["/admin/settings/appearance", "admin", "private"],
  ["/admin/settings/home", "admin", "private"],
  ["/admin/settings/email", "admin", "private"],
  ["/admin/settings/payments", "admin", "private"],
  ["/admin/settings/storage", "admin", "private"],
  ["/admin/settings/watermark", "admin", "private"],
  ["/admin/settings/danger", "admin", "private"],
  ["/admin/students", "admin", "private"],
  ["/admin/students/[id]", "admin", "private"],
  ["/admin/templates", "admin", "private"],
  ["/admin/templates/new", "admin", "private"],
  ["/admin/templates/[id]", "admin", "private"],
  ["/admin/templates/emails/[name]", "admin", "private"],
  ["/admin/workshops", "admin", "private"],
  ["/admin/workshops/new", "admin", "private"],
  ["/admin/workshops/[id]", "admin", "private"],
  ["/admin/workshops/[id]/edit", "admin", "private"],
  ["/admin/workshops/[id]/contract", "admin", "private"],
  ["/admin/workshops/[id]/finances", "admin", "private"],
  ["/admin/workshops/[id]/gallery", "admin", "private"],
  ["/admin/workshops/[id]/registrations", "admin", "private"],
  ["/admin/workshops/[id]/registrations/export", "admin", "private", "handler"],
  ["/admin/[...rest]", "admin", "private", "not-found"],
]

export const ROUTES: readonly RouteEntry[] = table.map(([path, area, access, kind = "page"]) => ({ path, area, access, kind }))

/** Route handlers outside the languages (never prefixed). /sitemap.xml and /robots.txt are metadata routes. */
export const UNLOCALIZED_HANDLERS: readonly string[] = [
  "/api/admin/media/watermark-preview",
  "/api/admin/money/export/[report]",
  "/api/admin/uploads",
  "/api/instructor/uploads",
  "/media/[...path]",
  // The site's share picture (Open Graph): its dot keeps the proxy away.
  "/og.png",
]

/** The names an area's open (sign-in) pages may have, the same in every area. */
export const AUTH_PAGES = ["login", "forgot", "reset", "signup", "verify", "invite"] as const

/**
 * Old addresses that emailed links still use → their new address. The proxy
 * answers them with a permanent redirect (308, query kept), in any language.
 */
export const LEGACY_PATHS: Readonly<Record<string, string>> = {
  "/admin/login/forgot": "/admin/forgot",
  "/admin/login/reset": "/admin/reset",
  "/admin/accept-invite": "/admin/invite",
  "/instructor/accept-invite": "/instructor/invite",
}

const AREA = /^\/(admin|instructor|account)(?:\/|$)/

/** The private area of a path without a language ("/admin/x" → "admin"), or null for the public site. */
export function areaOf(path: string): Exclude<Area, "site"> | null {
  return (AREA.exec(path)?.[1] as Exclude<Area, "site"> | undefined) ?? null
}

const segments = (path: string) => path.split(/[?#]/, 1)[0].split("/").filter(Boolean)
const isParam = (segment: string) => segment.startsWith("[")

function matches(entry: RouteEntry, parts: string[]): boolean {
  const pattern = segments(entry.path)
  return pattern.length === parts.length && pattern.every((p, i) => (isParam(p) ? parts[i].length > 0 : p === parts[i]))
}

/**
 * The route of a path without a language (query and hash ignored; `[x]`
 * stands for one segment), the most specific one when several match
 * ("/admin/categories/new" before "/admin/categories/[id]"). Never the
 * not-found catch-all: an unknown path is null.
 */
export function matchRoute(path: string): RouteEntry | null {
  const parts = segments(path)
  let best: RouteEntry | null = null
  let bestParams = Infinity
  for (const entry of ROUTES) {
    if (entry.kind === "not-found" || !matches(entry, parts)) continue
    const params = segments(entry.path).filter(isParam).length
    if (params < bestParams) [best, bestParams] = [entry, params]
  }
  return best
}

/** A sign-in page of an area, open without a session: exactly one of the `open` routes. */
export function isOpenPath(path: string): boolean {
  return ROUTES.some((r) => r.access === "open" && r.path === path)
}

/**
 * The address a path should have, in one step: the old names renamed, the
 * main language's prefix removed and a prefix in other letter case written in
 * lower case. Equal to `path` when it is already right. `path` is decoded,
 * without the query. `main` null: the main language is only guessed (the
 * setting not read yet, src/i18n/main-locale.ts), so a prefix stays (in lower
 * case): only what is true in every case is changed.
 */
export function canonicalPath(path: string, main: AppLocale | null): string {
  const { locale, rest } = splitLocale(path)
  const target = LEGACY_PATHS[rest] ?? rest
  return locale ? localePath(locale, target, main) : target
}
