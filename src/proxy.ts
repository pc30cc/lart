import createIntlMiddleware from "next-intl/middleware"
import { NextRequest, NextResponse } from "next/server"

import { routing } from "@/i18n/routing"
import { sessionCookieName } from "@/lib/auth/cookies"

/**
 * Runs before every page and API request:
 * - language routing (/fa, /tr, /en, always prefixed); "/" goes to src/app/page.tsx,
 * - a strict Content Security Policy with a fresh nonce per request,
 * - the requested path and query as the `x-pathname` request header (where a
 *   sign-in should come back to: `currentPath()` in lib/auth/request),
 * - noindex for the admin panel, the instructor panel, the member's account
 *   pages and their APIs,
 * - an optimistic redirect to the right sign-in page when a private page is
 *   opened without that area's session cookie (the sign-in pages themselves,
 *   OPEN_PATHS, stay open). The real checks happen on the server
 *   (requireAdmin / requireInstructor / requireMember) for every page and action.
 * Static security headers (HSTS, nosniff, ...) are set in next.config.ts.
 */
const intl = createIntlMiddleware(routing)

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

/** The three private areas: the super-admin panel, the instructor panel and the member's account pages. */
const AREA_PATH = /^\/(fa|tr|en)\/(admin|instructor|account)(?:\/|$)/
type Area = "admin" | "instructor" | "account"

/** The pages of each area that work without a session: sign in, sign up, emailed links. */
const OPEN_PATHS: Record<Area, RegExp> = {
  admin: /^\/(fa|tr|en)\/admin\/login(?:\/(?:forgot|reset))?\/?$/,
  instructor: /^\/(fa|tr|en)\/instructor\/(?:login|signup|accept-invite|forgot|reset|verify)\/?$/,
  account: /^\/(fa|tr|en)\/account\/(?:signup|login|verify|forgot|reset)\/?$/,
}

const cookieOf = { admin: "admin", instructor: "instructor", account: "member" } as const
const PRIVATE_API = /^\/api\/(?:admin|instructor|account)(?:\/|$)/

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const area = AREA_PATH.exec(pathname)
  const noindex = Boolean(area) || PRIVATE_API.test(pathname)

  // Optimistic check only: no cookie at all means "not signed in".
  if (
    area &&
    !OPEN_PATHS[area[2] as Area].test(pathname) &&
    (request.method === "GET" || request.method === "HEAD") &&
    !request.cookies.has(sessionCookieName(cookieOf[area[2] as Area]))
  ) {
    const [, locale, name] = area
    const login = new URL(`/${locale}/${name}/login`, request.url)
    // The admin login keeps only the path; the others come back to the query too.
    // A panel's own home is where its login goes anyway (a member's lands on the workshops).
    const back = name === "admin" ? pathname : pathname + search
    if (name === "account" || back !== `/${locale}/${name}`) login.searchParams.set("next", back)
    return withHeaders(NextResponse.redirect(login), null, noindex)
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const csp = contentSecurityPolicy(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("content-security-policy", csp)
  requestHeaders.set("x-pathname", (pathname + search).slice(0, 2048))

  const response =
    pathname === "/" || /^\/api(\/|$)/.test(pathname)
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : // A body-less copy: next-intl only reads the URL, headers and cookies, and
        // forwards these request headers (with the nonce) to the page.
        intl(new NextRequest(request.url, { headers: requestHeaders }))

  return withHeaders(response, csp, noindex)
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
