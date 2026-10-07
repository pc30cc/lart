import createIntlMiddleware from "next-intl/middleware"
import { NextRequest, NextResponse } from "next/server"

import { getMainLocaleState } from "@/i18n/main-locale"
import { localePath, splitLocale } from "@/i18n/paths"
import { routingFor, type AppLocale } from "@/i18n/routing"
import { sessionCookieName } from "@/lib/auth/cookies"
import { areaOf, canonicalPath, isOpenPath } from "@/lib/routes"

/**
 * Runs before every page and API request (docs/DEVELOPMENT.md, "URL rules"):
 * - the address rules: the main language (the `defaultLocale` setting, read
 *   through a 30-second cache) has no prefix, the others are under /fa, /en.
 *   A GET of an old address (the main language's prefix, a renamed sign-in
 *   page, a prefix in capitals) gets one permanent redirect (308, query kept,
 *   not cached: the main language can change) to its address today
 *   (`canonicalPath` in lib/routes). While the main language is only guessed
 *   (a cold start with the database slow or down), no prefix is removed: the
 *   prefixed page is served as it is,
 * - language routing by next-intl ("/" and every unprefixed path are the main
 *   language; nothing is guessed from the browser),
 * - a strict Content Security Policy with a fresh nonce per request,
 * - the requested path and query as the `x-pathname` request header (where a
 *   sign-in should come back to: `currentPath()` in lib/auth/request),
 * - noindex for the admin panel, the instructor panel, the member's account
 *   pages and their APIs, in every language,
 * - an optimistic redirect to the right sign-in page when a private page is
 *   opened without that area's session cookie (the sign-in pages themselves,
 *   the `open` routes of lib/routes, stay open). The real checks happen on the
 *   server (requireAdmin / requireInstructor / requireMember) for every page
 *   and action.
 * Static security headers (HSTS, nosniff, ...) are set in next.config.ts.
 */

/** One next-intl middleware per main language (three at most). */
const intlByMain = new Map<AppLocale, ReturnType<typeof createIntlMiddleware>>()
function intlFor(main: AppLocale) {
  let intl = intlByMain.get(main)
  if (!intl) intlByMain.set(main, (intl = createIntlMiddleware(routingFor(main))))
  return intl
}

const isDev = process.env.NODE_ENV === "development"

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes come from Radix / Sonner / next-themes. Scripts stay strict.
    "style-src 'self' 'unsafe-inline'",
    // Images and videos are served from the CDN chosen in the settings.
    "img-src 'self' blob: data: https:",
    "media-src 'self' blob: https:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ")
}

const cookieOf = { admin: "admin", instructor: "instructor", account: "member" } as const
const PRIVATE_API = /^\/api\/(?:admin|instructor|account)(?:\/|$)/

/**
 * The path as the router sees it: decoded ("/%61dmin" is "/admin") and
 * cleaned like next-intl does (backslashes escaped, tabs and new lines
 * dropped, repeated slashes merged), so an encoded or doubled variant of a
 * private path cannot pass the gate.
 */
function routerPath(pathname: string): string {
  let decoded = pathname
  try {
    decoded = decodeURI(pathname)
  } catch {
    // An invalid escape: Next answers 400 anyway; classify the raw path.
  }
  return decoded.replace(/\\/g, "%5C").replace(/[\t\n\r]/g, "").replace(/\/+/g, "/")
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl
  const readOnly = request.method === "GET" || request.method === "HEAD"
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const csp = contentSecurityPolicy(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("content-security-policy", csp)
  requestHeaders.set("x-pathname", (pathname + search).slice(0, 2048))

  // The APIs are never localized.
  if (/^\/api(\/|$)/.test(pathname)) {
    return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp, PRIVATE_API.test(pathname))
  }

  const { locale: main, known } = await getMainLocaleState()
  const path = routerPath(pathname)

  // An old address: one permanent redirect to today's, before the gate (an
  // emailed /admin/accept-invite?token=… link must reach the invitation page).
  // A guessed main language never decides a permanent redirect: the prefix
  // stays, only the renames and the letter case are fixed.
  if (readOnly) {
    const canonical = canonicalPath(path, known ? main : null)
    if (canonical !== path) return permanent(request, canonical, Boolean(areaOf(splitLocale(canonical).rest)))
  }

  const { locale: prefix, rest } = splitLocale(path)
  const area = areaOf(rest)
  const noindex = Boolean(area)

  // Optimistic check only: no cookie at all means "not signed in".
  if (area && readOnly && !isOpenPath(rest) && !request.cookies.has(sessionCookieName(cookieOf[area]))) {
    const login = new URL(localePath(prefix ?? main, `/${area}/login`, main), request.url)
    // The admin login keeps only the path; the others come back to the query too.
    // A panel's own home is where its login goes anyway (a member's lands on the workshops).
    const back = area === "admin" ? path : path + search
    if (area === "account" || rest !== `/${area}`) login.searchParams.set("next", back)
    return withHeaders(NextResponse.redirect(login), null, noindex)
  }

  // A server action posted to the main language's prefixed address (a page
  // opened before the main language changed), or any request there while the
  // main language is only guessed: served as it is, no redirect.
  if (prefix === main && (path === `/${main}` || path.startsWith(`/${main}/`))) {
    requestHeaders.set("x-next-intl-locale", main)
    return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp, noindex)
  }

  // "/" and every unprefixed path: rewritten to the main language; /fa/… and
  // /en/…: their language. A body-less copy: next-intl only reads the URL,
  // headers and cookies, and forwards these request headers (with the nonce)
  // to the page.
  return withHeaders(intlFor(main)(new NextRequest(request.url, { headers: requestHeaders })), csp, noindex)
}

/** 308 to `pathname` (query kept). Never cached: it depends on the main language, a setting. */
function permanent(request: NextRequest, pathname: string, noindex: boolean) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  const response = NextResponse.redirect(url, 308)
  response.headers.set("Cache-Control", "no-store")
  return withHeaders(response, null, noindex)
}

function withHeaders(response: NextResponse, csp: string | null, noindex: boolean) {
  if (csp) response.headers.set("Content-Security-Policy", csp)
  if (noindex) response.headers.set("X-Robots-Tag", "noindex, nofollow")
  return response
}

export const config = {
  // Everything except Next internals, local media files, files with an extension
  // and the upload endpoints of the admin and instructor panels (Next.js would
  // buffer upload bodies through the proxy and cut them at 10 MB).
  matcher: ["/((?!_next|_vercel|media/|api/admin/uploads|api/instructor/uploads|.*\\..*).*)"],
}
