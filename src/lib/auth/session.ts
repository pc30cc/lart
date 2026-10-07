import "server-only"
import { and, eq, lt } from "drizzle-orm"
import { cookies } from "next/headers"

import { db, type Db, type Tx } from "@/db"
import { admins, sessions } from "@/db/schema"
import { randomToken, sha256 } from "@/lib/crypto"
import { sessionCookieName, sessionCookieSecure, type PrincipalKind } from "./cookies"

/**
 * Database sessions, shared by every principal kind (admin, instructor, member).
 * The cookie holds a 256-bit random token; the database stores only its SHA-256,
 * so a database leak does not leak usable sessions.
 *
 * Expiry is sliding for a person's own session: it ends after `idleMs` without
 * use, and in any case `absoluteMs` after sign-in. It is extended once less
 * than half the idle window remains (at most a write every idleMs / 2).
 *
 * A session a super admin opened as an instructor or member ("Enter their
 * panel", `impersonated_by` set) lasts `IMPERSONATION_MS` from its creation and
 * never slides; it also ends as soon as that admin is inactive or gone.
 */
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

/** How long a super admin may view the panel as someone else: one hour, never extended. */
export const IMPERSONATION_MS = HOUR

export const sessionPolicy: Record<PrincipalKind, { idleMs: number; absoluteMs: number }> = {
  admin: { idleMs: 12 * HOUR, absoluteMs: 7 * DAY },
  instructor: { idleMs: 7 * DAY, absoluteMs: 30 * DAY },
  member: { idleMs: 30 * DAY, absoluteMs: 90 * DAY },
}

/** The kinds a super admin can view the panel as. Never an admin. */
export type ImpersonableKind = Exclude<PrincipalKind, "admin">

export type ValidSession = {
  id: string
  subjectId: string
  expiresAt: Date
  /** The super admin viewing as this person, or null for the person's own session. */
  impersonatedBy: { id: string; name: string } | null
}

/**
 * Create a session row. Returns the token for the cookie (never stored).
 * `impersonatedBy`: the super admin viewing as this person (1 hour, never for an admin session).
 * Pass `tx` inside a transaction.
 */
export async function createSession(
  kind: PrincipalKind,
  subjectId: string,
  now = new Date(),
  options: { impersonatedBy?: string; tx?: Db | Tx } = {},
) {
  const impersonatedBy = options.impersonatedBy ?? null
  if (impersonatedBy && kind === "admin") throw new Error("admin sessions cannot be impersonated")
  const tx = options.tx ?? db
  const token = randomToken()
  const id = sha256(token)
  const expiresAt = new Date(now.getTime() + (impersonatedBy ? IMPERSONATION_MS : sessionPolicy[kind].idleMs))
  await tx.insert(sessions).values({ id, kind, subjectId, expiresAt, createdAt: now, impersonatedBy })
  // Housekeeping: drop this subject's expired sessions.
  await tx
    .delete(sessions)
    .where(and(eq(sessions.kind, kind), eq(sessions.subjectId, subjectId), lt(sessions.expiresAt, now)))
  return { id, token, expiresAt }
}

/**
 * Check a cookie token: returns the session (sliding its expiry) or null. A
 * viewing session (`impersonated_by`) needs its admin to be active, ends one
 * hour after it was created and never slides.
 */
export async function validateSession(
  kind: PrincipalKind,
  token: string | undefined,
  now = new Date(),
): Promise<ValidSession | null> {
  if (!token || token.length > 128) return null
  const id = sha256(token)
  const [row] = await db
    .select({ s: sessions, adminName: admins.name, adminActive: admins.active })
    .from(sessions)
    .leftJoin(admins, eq(admins.id, sessions.impersonatedBy))
    .where(and(eq(sessions.id, id), eq(sessions.kind, kind)))
    .limit(1)
  if (!row) return null

  const viewer = row.s.impersonatedBy
  if (viewer && (kind === "admin" || !row.adminActive)) {
    // The admin is inactive or gone (or the row is impossible): the viewing ends.
    await deleteSession(id)
    return null
  }

  const { idleMs, absoluteMs } = sessionPolicy[kind]
  const hardEnd = row.s.createdAt.getTime() + (viewer ? IMPERSONATION_MS : absoluteMs)
  if (row.s.expiresAt.getTime() <= now.getTime() || hardEnd <= now.getTime()) {
    await deleteSession(id)
    return null
  }

  let expiresAt = row.s.expiresAt
  // Only a person's own session slides: a viewing session keeps its one hour.
  if (!viewer && expiresAt.getTime() - now.getTime() < idleMs / 2) {
    expiresAt = new Date(Math.min(now.getTime() + idleMs, hardEnd))
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id))
  }
  return {
    id,
    subjectId: row.s.subjectId,
    expiresAt,
    impersonatedBy: viewer ? { id: viewer, name: row.adminName ?? "" } : null,
  }
}

export async function deleteSession(id: string) {
  await db.delete(sessions).where(eq(sessions.id, id))
}

/**
 * Sign a subject out everywhere (e.g. after a password change or deactivation),
 * including any admin viewing as them. Pass `tx` inside a transaction.
 */
export async function deleteSessionsOf(kind: PrincipalKind, subjectId: string, tx: Db | Tx = db) {
  await tx.delete(sessions).where(and(eq(sessions.kind, kind), eq(sessions.subjectId, subjectId)))
}

/** End every session this admin opened as someone else, in every browser. Returns whom they were viewing as. */
export async function deleteImpersonationsBy(
  adminId: string,
  tx: Db | Tx = db,
): Promise<{ kind: PrincipalKind; subjectId: string }[]> {
  return tx
    .delete(sessions)
    .where(eq(sessions.impersonatedBy, adminId))
    .returning({ kind: sessions.kind, subjectId: sessions.subjectId })
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

/** The session of that kind this browser had before "Enter their panel" (now deleted). */
export type ReplacedSession = { subjectId: string; impersonatedBy: string | null }

/**
 * "Enter their panel": a super admin starts a one-hour session as this
 * instructor or member in this browser. The session of that kind this browser
 * had (the person's own, or an earlier viewing) is deleted and returned as
 * `replaced`; the admin's own cookie is never touched. Call from a server action.
 *
 * `audit` writes the start (and the end of a replaced viewing) in the same
 * transaction as the old row's delete and the new row's insert: if it throws,
 * nothing changed. The cookie is set only after the commit, so there is never
 * a viewing session without its audit entry.
 */
export async function startImpersonation(
  kind: ImpersonableKind,
  subjectId: string,
  adminId: string,
  audit?: (tx: Tx, replaced: ReplacedSession | null) => Promise<void>,
) {
  const store = await cookies()
  const name = sessionCookieName(kind)
  const old = store.get(name)?.value
  const started = await db.transaction(async (tx) => {
    let replaced: ReplacedSession | null = null
    if (old && old.length <= 128) {
      const [row] = await tx
        .delete(sessions)
        .where(and(eq(sessions.id, sha256(old)), eq(sessions.kind, kind)))
        .returning({ subjectId: sessions.subjectId, impersonatedBy: sessions.impersonatedBy })
      replaced = row ?? null
    }
    const session = await createSession(kind, subjectId, new Date(), { impersonatedBy: adminId, tx })
    await audit?.(tx, replaced)
    return { ...session, replaced }
  })
  store.set(name, started.token, { ...cookieOptions, maxAge: IMPERSONATION_MS / 1000 })
  return started
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
