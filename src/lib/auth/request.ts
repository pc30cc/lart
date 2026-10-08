import "server-only"
import { headers } from "next/headers"

import { env } from "@/lib/env"

export { clientIp } from "./client-ip"

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

/**
 * The path (and query) of the page being requested: `src/proxy.ts` passes it
 * as `x-pathname`, also for server actions posted from a page. Used as the
 * "next" of a sign-in redirect; always check it with `safeNext`.
 */
export async function currentPath(): Promise<string | undefined> {
  try {
    return (await headers()).get("x-pathname") ?? undefined
  } catch {
    return undefined // outside a request
  }
}
