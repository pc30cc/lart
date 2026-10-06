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
 *
 * Race-safe: before the password is checked, one UPDATE (row-locked by
 * PostgreSQL) claims an attempt. The claim that uses up the last try also sets
 * the lock, so concurrent attempts beyond `maxFailures` are refused as
 * "locked" and a burst cannot test more passwords than the policy allows.
 * The right password on a claimed try clears the counters and the lock.
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
    sql`select id, password_hash, ${active} as active from ${table} where email = ${email} limit 1`,
  )
  const account = rows[0]
  const usable = account?.password_hash && account.active ? { id: account.id, hash: account.password_hash } : null

  // Claim a try. An expired lock starts a new count. No row back: locked.
  let attempt: number | null = null
  if (usable) {
    const at = sql`${now.toISOString()}::timestamptz`
    const count = sql`(case when locked_until is null then failed_logins + 1 else 1 end)`
    const lockAt = new Date(now.getTime() + LOCKOUT.lockMs).toISOString()
    const { rows: claimed } = await db.execute<{ failed_logins: number }>(sql`
      update ${table} set
        failed_logins = ${count},
        locked_until = case when ${count} >= ${LOCKOUT.maxFailures} then ${lockAt}::timestamptz end
      where id = ${usable.id} and (locked_until is null or locked_until <= ${at})
      returning failed_logins`)
    attempt = claimed[0] ? Number(claimed[0].failed_logins) : null
  }

  const valid = await verifyPassword(usable?.hash ?? (await dummyHash()), password)

  if (!usable) return { ok: false, reason: "invalid" }
  if (attempt === null) return { ok: false, reason: "locked", id: usable.id }
  if (!valid) {
    // Only the request that claimed the last try set the lock: it reports (and audits) it.
    const lockedNow = attempt >= LOCKOUT.maxFailures
    return { ok: false, reason: lockedNow ? "locked" : "invalid", id: usable.id, lockedNow }
  }

  await db.execute(sql`update ${table} set failed_logins = 0, locked_until = null where id = ${usable.id}`)
  if (needsRehash(usable.hash)) {
    const rehashed = await hashPassword(password)
    await db.execute(sql`update ${table} set password_hash = ${rehashed} where id = ${usable.id}`)
  }
  return { ok: true, id: usable.id }
}
