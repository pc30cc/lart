import "server-only"

import { env } from "@/lib/env"

/**
 * The client IP as seen by the reverse proxy (Coolify / Traefik overwrites
 * these headers, so the first X-Forwarded-For entry is the real client).
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim()
  if (real) return real.slice(0, 64)
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return forwarded ? forwarded.slice(0, 64) : null
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * CSRF guard for route handlers: unsafe methods must come from our own origin.
 * Uses `Origin` (sent by all modern browsers on POST/PUT/PATCH/DELETE) and
 * falls back to `Sec-Fetch-Site`. A request with neither is refused.
 */
export function isSameOrigin(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true
  const origin = request.headers.get("origin")
  if (origin) {
    if (origin === new URL(env.APP_URL).origin) return true
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
    if (!host) return false
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin"
}
