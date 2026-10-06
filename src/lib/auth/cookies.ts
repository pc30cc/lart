/**
 * Session cookie names, shared by the server code and `src/proxy.ts`.
 * No "server-only" import: the proxy needs the names for its optimistic check.
 */

export type PrincipalKind = "admin" | "instructor" | "member"

const secure = process.env.NODE_ENV === "production"

/**
 * One cookie per principal kind, so the three logins never share a session.
 * In production the `__Host-` prefix pins the cookie to this exact host,
 * over HTTPS, on path "/".
 */
export function sessionCookieName(kind: PrincipalKind): string {
  return `${secure ? "__Host-" : ""}${kind}_session`
}

export const sessionCookieSecure = secure
