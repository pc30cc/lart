import "server-only"
import { and, eq, gt, isNull, type SQL } from "drizzle-orm"

import { db, type Db, type Tx } from "@/db"
import { emailTokens } from "@/db/schema"
import { randomToken, sha256 } from "@/lib/crypto"
import type { PrincipalKind } from "./cookies"

/**
 * One-time email links (verify email, reset password, instructor invite) for
 * any principal kind. The link carries a 256-bit random token; the database
 * keeps only its SHA-256 (`email_tokens.id`).
 */

export type TokenPurpose = (typeof emailTokens.$inferSelect)["purpose"]

const MINUTE = 60_000
/** How long each kind of link works. The invite's lifetime is set where it is issued (features/instructors). */
export const TOKEN_TTL = {
  verify_email: 24 * 60 * MINUTE,
  reset_password: 30 * MINUTE,
} as const

/** Tokens from a link are 43 characters; anything far longer is not ours. */
export const isTokenShaped = (token: unknown): token is string =>
  typeof token === "string" && token.length > 0 && token.length <= 128

/**
 * A new link token. Earlier unused links of the same purpose stop working, so
 * only the newest one opens. Returns the token (for the link; never stored).
 */
export async function issueEmailToken(
  kind: PrincipalKind,
  purpose: TokenPurpose,
  subjectId: string,
  ttlMs: number,
  { tx = db, now = new Date() }: { tx?: Db | Tx; now?: Date } = {},
): Promise<string> {
  const token = randomToken()
  await tx.delete(emailTokens).where(unusedTokensOf(kind, subjectId, purpose))
  await tx.insert(emailTokens).values({
    id: sha256(token),
    purpose,
    kind,
    subjectId,
    expiresAt: new Date(now.getTime() + ttlMs),
    createdAt: now,
  })
  return token
}

/** Unused tokens of a person (of one purpose, or all). */
export const unusedTokensOf = (kind: PrincipalKind, subjectId: string, purpose?: TokenPurpose) =>
  and(
    eq(emailTokens.kind, kind),
    eq(emailTokens.subjectId, subjectId),
    purpose ? eq(emailTokens.purpose, purpose) : undefined,
    isNull(emailTokens.usedAt),
  )

/**
 * Conditions of a link that still works: this token, kind and purpose, unused
 * and not expired, plus `also` (e.g. "the instructor is active").
 */
export const liveToken = (token: string, kind: PrincipalKind, purpose: TokenPurpose, now: Date, also?: SQL) =>
  and(
    eq(emailTokens.id, sha256(token)),
    eq(emailTokens.kind, kind),
    eq(emailTokens.purpose, purpose),
    isNull(emailTokens.usedAt),
    gt(emailTokens.expiresAt, now),
    also,
  )

type TokenQuery = { kind: PrincipalKind; purpose: TokenPurpose; also?: SQL; now?: Date }

/** The person a working link belongs to (without using it up), or null. */
export async function peekEmailToken(token: unknown, q: TokenQuery): Promise<string | null> {
  if (!isTokenShaped(token)) return null
  const [row] = await db
    .select({ subjectId: emailTokens.subjectId })
    .from(emailTokens)
    .where(liveToken(token, q.kind, q.purpose, q.now ?? new Date(), q.also))
    .limit(1)
  return row?.subjectId ?? null
}

/**
 * Use up a working link inside the caller's transaction (row-locked by the
 * UPDATE, so two clicks cannot both use it). Returns the person's id, or null.
 */
export async function consumeEmailToken(tx: Tx, token: unknown, q: TokenQuery): Promise<string | null> {
  if (!isTokenShaped(token)) return null
  const now = q.now ?? new Date()
  const [row] = await tx
    .update(emailTokens)
    .set({ usedAt: now })
    .where(liveToken(token, q.kind, q.purpose, now, q.also))
    .returning({ subjectId: emailTokens.subjectId })
  return row?.subjectId ?? null
}
