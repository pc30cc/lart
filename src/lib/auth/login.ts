import "server-only"
import { sql } from "drizzle-orm"

import { db } from "@/db"
import { admins, instructors, members } from "@/db/schema"
import type { PrincipalKind } from "./cookies"
import { dummyHash, hashPassword, needsRehash, verifyPassword } from "./password"

/** After this many wrong passwords in a row, the account is locked for `lockMs`. */
export const LOCKOUT = { maxFailures: 5, lockMs: 15 * 60_000 } as const

const tables = { admin: admins, instructor: instructors, member: members } as const

// Prepare the dummy hash at startup, so the first unknown-email login is not slower.
void dummyHash()

type AccountRow = {
  id: string
  password_hash: string | null
  active: boolean
  locked_until: Date | string | null
}

export type CredentialsResult =
  | { ok: true; id: string }
  | { ok: false; reason: "invalid" | "locked"; id?: string; lockedNow?: boolean }

/** Emails are stored lower-case; normalise input the same way. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase()

/**
 * Check an email + password for any principal kind, with per-account lockout.
 * Always runs exactly one Argon2 verification, so unknown, inactive, locked
 * and wrong-password cases take the same time. Callers must show one generic
 * message for every failure (no user enumeration).
 */
export async function verifyCredentials(
  kind: PrincipalKind,
  emailInput: string,
  password: string,
  now = new Date(),
): Promise<CredentialsResult> {
  const table = tables[kind]
  const email = normalizeEmail(emailInput)
  const active = kind === "member" ? sql`true` : sql`active`
  const { rows } = await db.execute<AccountRow>(
    sql`select id, password_hash, ${active} as active, locked_until from ${table} where email = ${email} limit 1`,
  )
  const account = rows[0]
  const stored = account?.password_hash ?? (await dummyHash())
  const valid = await verifyPassword(stored, password)

  if (!account || !account.password_hash || !account.active) return { ok: false, reason: "invalid" }

  const lockedUntil = account.locked_until ? new Date(account.locked_until) : null
  if (lockedUntil && lockedUntil > now) return { ok: false, reason: "locked", id: account.id }

  if (!valid) {
    const lockAt = new Date(now.getTime() + LOCKOUT.lockMs)
    const { rows: updated } = await db.execute<{ locked_until: Date | string | null }>(sql`
      update ${table} set
        failed_logins = case when failed_logins + 1 >= ${LOCKOUT.maxFailures} then 0 else failed_logins + 1 end,
        locked_until = case when failed_logins + 1 >= ${LOCKOUT.maxFailures} then ${lockAt.toISOString()}::timestamptz else null end
      where id = ${account.id}
      returning locked_until`)
    const lockedNow = updated[0]?.locked_until != null
    return { ok: false, reason: lockedNow ? "locked" : "invalid", id: account.id, lockedNow }
  }

  await db.execute(sql`update ${table} set failed_logins = 0, locked_until = null where id = ${account.id}`)
  if (needsRehash(account.password_hash)) {
    const rehashed = await hashPassword(password)
    await db.execute(sql`update ${table} set password_hash = ${rehashed} where id = ${account.id}`)
  }
  return { ok: true, id: account.id }
}
