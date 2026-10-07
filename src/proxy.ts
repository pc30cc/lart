import createIntlMiddleware from "next-intl/middleware"
import { NextRequest, NextResponse } from "next/server"

import { routing } from "@/i18n/routing"
import { sessionCookieName } from "@/lib/auth/cookies"

/**
 * Runs before every page and API request:
 * - language routing (/fa, /tr, /en, always prefixed); "/" goes to src/app/page.tsx,
 * - a strict Content Security Policy with a fresh nonce per request,
 * - noindex for the admin panel and admin API,
 * - an optimistic redirect to the admin login when there is no admin cookie
 *   (except on the sign-in pages themselves, ADMIN_LOGIN_PATH).
 *   The real checks happen on the server (requireAdmin) for every page and action.
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
    // iyzico's hosted payment page is a top-level redirect; PayTR's is an iframe.
    "frame-src 'self' https://www.paytr.com",
    // A registration may be sent on to iyzico's hosted payment page.
    "form-action 'self' https://sandbox-cpp.iyzipay.com https://cpp.iyzipay.com",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ")
}

const ADMIN_PATH = /^\/(fa|tr|en)\/admin(?:\/|$)/
/** The sign-in pages, open without a session: sign in, forgot password, new password from a reset link. */
const ADMIN_LOGIN_PATH = /^\/(fa|tr|en)\/admin\/login(?:\/(?:forgot|reset))?\/?$/

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAdmin = ADMIN_PATH.test(pathname) || pathname.startsWith("/api/admin")

  // Optimistic check only: no cookie at all means "not signed in".
  const adminMatch = ADMIN_PATH.exec(pathname)
  if (
    adminMatch &&
    !ADMIN_LOGIN_PATH.test(pathname) &&
    (request.method === "GET" || request.method === "HEAD") &&
    !request.cookies.has(sessionCookieName("admin"))
  ) {
    const login = new URL(`/${adminMatch[1]}/admin/login`, request.url)
    if (pathname !== `/${adminMatch[1]}/admin`) login.searchParams.set("next", pathname)
    return withHeaders(NextResponse.redirect(login), null, isAdmin)
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const csp = contentSecurityPolicy(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("content-security-policy", csp)

  const response =
    pathname === "/" || /^\/api(\/|$)/.test(pathname)
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : // A body-less copy: next-intl only reads the URL, headers and cookies, and
        // forwards these request headers (with the nonce) to the page.
        intl(new NextRequest(request.url, { headers: requestHeaders }))

  return withHeaders(response, csp, isAdmin)
}

function withHeaders(response: NextResponse, csp: string | null, noindex: boolean) {
  if (csp) response.headers.set("Content-Security-Policy", csp)
  if (noindex) response.headers.set("X-Robots-Tag", "noindex, nofollow")
  return response
}

export const config = {
  // Everything except Next internals, local media files, files with an extension
  // and the upload endpoint (Next.js would buffer large upload bodies through the proxy).
  matcher: ["/((?!_next|_vercel|media/|api/admin/uploads|.*\\..*).*)"],
}
