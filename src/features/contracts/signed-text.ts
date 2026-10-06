import "server-only"
import { and, desc, eq, isNotNull, sql } from "drizzle-orm"

import { db, type Db, type Tx } from "@/db"
import { auditLog, contracts, instructors } from "@/db/schema"
import { audit } from "@/lib/audit"
import { CIPHERTEXT_PATTERN, decrypt, encrypt, isCiphertext, sha256 } from "@/lib/crypto"

/**
 * The exact text an instructor signed (`contracts.signed_text`) at rest. It
 * contains the instructor's ID number, so it is stored encrypted like the ID
 * number itself (`lib/crypto.ts`, AES-256-GCM); `signed_text_sha256` stays the
 * SHA-256 of the plain text, the evidence of what was signed, and the same
 * hash is in the append-only audit log (`contract.sign`).
 *
 * Every write goes through `sealSignedText` and every read through
 * `openSignedText` / `checkSignedText`, only in server code and only for super
 * admins (phase 2: also the instructor who signed). The plain text never goes
 * to the public site, the logs or the audit log.
 */

/** The columns to store for a text being signed now: the ciphertext and the SHA-256 of the plain text. */
export function sealSignedText(plain: string): { signedText: string; signedTextSha256: string } {
  return { signedText: encrypt(plain), signedTextSha256: sha256(plain) }
}

/**
 * The plain signed text from the stored value. A value that does not look like
 * ciphertext is legacy plain text (signed before the text was encrypted, until
 * `pnpm contracts:encrypt` runs) and is returned as it is: use
 * `checkSignedText` to show it, which flags it. Ciphertext that does not
 * decrypt (another key, tampering) throws.
 */
export function openSignedText(stored: string): string {
  return isCiphertext(stored) ? decrypt(stored) : stored
}

/**
 * How far a stored signed text can be trusted, worst first:
 * - `unreadable`: ciphertext that does not decrypt (another key, or changed);
 * - `mismatch`: the text, `signed_text_sha256` and the hash in the audit log's
 *   `contract.sign` entry don't all agree, or there is no such entry: the text
 *   may have been replaced (plain text needs no key to forge, and a ciphertext
 *   can be copied from another contract), so it is not the proven signed text;
 * - `unencrypted`: they agree, but the text is still stored as plain text
 *   (signed before it was encrypted: `pnpm contracts:encrypt`);
 * - `ok`: decrypted, and it matches both hashes.
 */
export type SignedTextCheck = "ok" | "unencrypted" | "mismatch" | "unreadable"

/**
 * Open a stored signed text and check it against its SHA-256 and the hashes
 * recorded when it was signed (`recorded`: `data.sha256` of every
 * `contract.sign` audit entry of the contract). `text` is null when unreadable.
 */
export function checkSignedText(
  stored: string,
  storedSha256: string | null,
  recorded: readonly (string | null)[],
): { text: string | null; check: SignedTextCheck } {
  let text: string
  try {
    text = openSignedText(stored)
  } catch {
    return { text: null, check: "unreadable" }
  }
  const hash = sha256(text)
  const matches = storedSha256 === hash && recorded.length > 0 && recorded.every((h) => h === hash)
  return { text, check: !matches ? "mismatch" : isCiphertext(stored) ? "ok" : "unencrypted" }
}

/** The SHA-256 recorded in the audit log when the contract was signed (one entry, unless someone added more). */
export async function recordedSignatureHashes(contractId: string, database: Db = db): Promise<(string | null)[]> {
  const rows = await database
    .select({ sha256: sql<string | null>`${auditLog.data} ->> 'sha256'` })
    .from(auditLog)
    .where(and(eq(auditLog.action, "contract.sign"), eq(auditLog.entity, "contract"), eq(auditLog.entityId, contractId)))
  return rows.map((r) => r.sha256)
}

// ─── Encrypting legacy plain texts (pnpm contracts:encrypt) ─────────────────

/** Rows whose signed text is still plain text. */
const legacy = and(isNotNull(contracts.signedText), sql`${contracts.signedText} !~ ${CIPHERTEXT_PATTERN}`)

/**
 * Whether this process has the app's ENCRYPTION_KEY: it must decrypt what the
 * app has already encrypted (the newest instructor ID number and the newest
 * encrypted signed text). Null when nothing is encrypted yet, so there is
 * nothing to check the key against.
 */
export async function keyDecryptsData(database: Db = db): Promise<boolean | null> {
  const [instructor] = await database
    .select({ value: instructors.idNumberEnc })
    .from(instructors)
    .where(sql`${instructors.idNumberEnc} ~ ${CIPHERTEXT_PATTERN}`)
    .orderBy(desc(instructors.updatedAt))
    .limit(1)
  const [contract] = await database
    .select({ value: contracts.signedText })
    .from(contracts)
    .where(sql`${contracts.signedText} ~ ${CIPHERTEXT_PATTERN}`)
    .orderBy(sql`${contracts.signedAt} desc nulls last`)
    .limit(1)
  const samples = [instructor?.value, contract?.value].filter((v): v is string => Boolean(v))
  if (!samples.length) return null
  return samples.every((value) => {
    try {
      decrypt(value)
      return true
    } catch {
      return false
    }
  })
}

/**
 * Thrown before anything is changed when the key can't be trusted: `mismatch`
 * (it does not decrypt the app's data: another key, e.g. the development key
 * from `.env`) or `unverified` (nothing encrypted to check it against, and
 * `unverifiedKey` was not given).
 */
export class SignedTextKeyError extends Error {
  constructor(readonly reason: "mismatch" | "unverified") {
    super(`ENCRYPTION_KEY ${reason === "mismatch" ? "does not decrypt the app's data" : "can't be checked against any encrypted data"}`)
    this.name = "SignedTextKeyError"
  }
}

export type EncryptLegacyOptions = {
  /** Only count and check (key, hashes): change nothing. */
  dryRun?: boolean
  /** Run although no encrypted data can confirm the key (a database where nothing is encrypted yet). */
  unverifiedKey?: boolean
}

export type EncryptLegacyResult = {
  /** Contracts that still held the plain text. */
  found: number
  /** Of those, encrypted now (one changed meanwhile is left for the next run; 0 in a dry run). */
  encrypted: number
  /** Contracts whose stored text does not match its SHA-256 (encrypted all the same; the hash is kept). */
  hashMismatch: string[]
}

/**
 * Encrypt every signed text still stored as plain text (`pnpm contracts:encrypt`).
 *
 * First makes sure the key is the app's (`keyDecryptsData`): encrypting with
 * another key would replace the only copy of each text with ciphertext the app
 * can't read, and a later run could not repair it (the rows no longer look
 * like plain text). Throws `SignedTextKeyError` before changing anything.
 *
 * Idempotent: ciphertext is never touched, so it can run any number of times.
 * The text itself does not change (the hash still matches it), and each row is
 * audited as `contract.encrypt` (with the hash, never the text). The old row
 * versions keep the plain text on disk until `VACUUM FULL contracts` (the
 * script runs it), and in WAL and backups taken before (docs/DEVELOPMENT.md).
 */
export async function encryptLegacySignedTexts(
  database: Db = db,
  { dryRun = false, unverifiedKey = false }: EncryptLegacyOptions = {},
): Promise<EncryptLegacyResult> {
  const rows = await database
    .select({ id: contracts.id, signedText: contracts.signedText, signedTextSha256: contracts.signedTextSha256 })
    .from(contracts)
    .where(legacy)
  const key = await keyDecryptsData(database)
  if (key === false) throw new SignedTextKeyError("mismatch")
  if (key === null && rows.length && !unverifiedKey) throw new SignedTextKeyError("unverified")

  const result: EncryptLegacyResult = { found: rows.length, encrypted: 0, hashMismatch: [] }
  if (dryRun) {
    result.hashMismatch = rows.filter((r) => r.signedTextSha256 !== sha256(r.signedText!)).map((r) => r.id)
    return result
  }
  for (const { id } of rows) {
    await database.transaction(async (tx: Tx) => {
      const [row] = await tx
        .select({ signedText: contracts.signedText, signedTextSha256: contracts.signedTextSha256 })
        .from(contracts)
        .where(and(eq(contracts.id, id), legacy))
        .for("update")
      if (!row?.signedText) return // encrypted meanwhile
      const plain = row.signedText
      const matches = row.signedTextSha256 === sha256(plain)
      if (!matches) result.hashMismatch.push(id)
      await tx.update(contracts).set({ signedText: encrypt(plain) }).where(eq(contracts.id, id))
      await audit(
        {
          adminId: null,
          action: "contract.encrypt",
          entity: "contract",
          entityId: id,
          data: { sha256: row.signedTextSha256, hashMatches: matches },
        },
        tx,
      )
      result.encrypted++
    })
  }
  return result
}
