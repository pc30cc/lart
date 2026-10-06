import "server-only"
import { and, eq, lt } from "drizzle-orm"
import { cookies } from "next/headers"

import { db, type Db, type Tx } from "@/db"
import { sessions } from "@/db/schema"
import { randomToken, sha256 } from "@/lib/crypto"
import { sessionCookieName, sessionCookieSecure, type PrincipalKind } from "./cookies"

/**
 * Database sessions, shared by every principal kind (admin, instructor, member).
 * The cookie holds a 256-bit random token; the database stores only its SHA-256,
 * so a database leak does not leak usable sessions.
 *
 * Expiry is sliding: a session ends after `idleMs` without use, and in any case
 * `absoluteMs` after sign-in. It is extended once less than half the idle
 * window remains (at most a write every idleMs / 2).
 */
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

export const sessionPolicy: Record<PrincipalKind, { idleMs: number; absoluteMs: number }> = {
  admin: { idleMs: 12 * HOUR, absoluteMs: 7 * DAY },
  instructor: { idleMs: 7 * DAY, absoluteMs: 30 * DAY },
  member: { idleMs: 30 * DAY, absoluteMs: 90 * DAY },
}

export type ValidSession = { id: string; subjectId: string; expiresAt: Date }

/** Create a session row. Returns the token for the cookie (never stored). */
export async function createSession(kind: PrincipalKind, subjectId: string, now = new Date()) {
  const token = randomToken()
  const id = sha256(token)
  const expiresAt = new Date(now.getTime() + sessionPolicy[kind].idleMs)
  await db.insert(sessions).values({ id, kind, subjectId, expiresAt, createdAt: now })
  // Housekeeping: drop this subject's expired sessions.
  await db
    .delete(sessions)
    .where(and(eq(sessions.kind, kind), eq(sessions.subjectId, subjectId), lt(sessions.expiresAt, now)))
  return { id, token, expiresAt }
}

/** Check a cookie token: returns the session (sliding its expiry) or null. */
export async function validateSession(
  kind: PrincipalKind,
  token: string | undefined,
  now = new Date(),
): Promise<ValidSession | null> {
  if (!token || token.length > 128) return null
  const id = sha256(token)
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.kind, kind)))
    .limit(1)
  if (!row) return null

  const { idleMs, absoluteMs } = sessionPolicy[kind]
  const hardEnd = row.createdAt.getTime() + absoluteMs
  if (row.expiresAt.getTime() <= now.getTime() || hardEnd <= now.getTime()) {
    await deleteSession(id)
    return null
  }

  let expiresAt = row.expiresAt
  if (expiresAt.getTime() - now.getTime() < idleMs / 2) {
    expiresAt = new Date(Math.min(now.getTime() + idleMs, hardEnd))
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id))
  }
  return { id, subjectId: row.subjectId, expiresAt }
}

export async function deleteSession(id: string) {
  await db.delete(sessions).where(eq(sessions.id, id))
}

/** Sign a subject out everywhere (e.g. after a password change or deactivation). Pass `tx` inside a transaction. */
export async function deleteSessionsOf(kind: PrincipalKind, subjectId: string, tx: Db | Tx = db) {
  await tx.delete(sessions).where(and(eq(sessions.kind, kind), eq(sessions.subjectId, subjectId)))
}

// ─── Cookie helpers (server actions and route handlers only) ──────────────────

const cookieOptions = {
  httpOnly: true,
  secure: sessionCookieSecure,
  sameSite: "lax" as const,
  path: "/",
}

/** Create a session and set its cookie. Call from a server action or route handler. */
export async function startSession(kind: PrincipalKind, subjectId: string) {
  const session = await createSession(kind, subjectId)
  const store = await cookies()
  store.set(sessionCookieName(kind), session.token, {
    ...cookieOptions,
    maxAge: Math.floor(sessionPolicy[kind].absoluteMs / 1000),
  })
  return session
}

/** The current session of this kind from the request cookie, or null. */
export async function currentSession(kind: PrincipalKind): Promise<ValidSession | null> {
  const token = (await cookies()).get(sessionCookieName(kind))?.value
  return validateSession(kind, token)
}

/** Delete the current session row and its cookie. Call from a server action. */
export async function endSession(kind: PrincipalKind) {
  const store = await cookies()
  const name = sessionCookieName(kind)
  const token = store.get(name)?.value
  if (token) await deleteSession(sha256(token))
  store.set(name, "", { ...cookieOptions, maxAge: 0 })
}
