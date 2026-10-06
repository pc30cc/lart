/**
 * Encrypt signed contract texts that are still stored as plain text.
 * Run once after deploying the encrypted signed text, in the app's own
 * environment (e.g. a terminal in the app's container):
 *
 *   pnpm contracts:encrypt --dry-run   # count and check only, change nothing
 *   pnpm contracts:encrypt
 *
 * Contracts signed before `contracts.signed_text` was encrypted hold the plain
 * text, which contains the instructor's ID number. SQL can't encrypt them (the
 * key is only in the app's environment), so this script does, with the app's
 * own code (`encryptLegacySignedTexts` in src/features/contracts/signed-text.ts).
 * Needs DATABASE_URL and the same ENCRYPTION_KEY as the app. A missing
 * variable is taken from `.env` (the development key there is not the app's).
 *
 * The key is checked first: it must decrypt data the app already encrypted
 * (instructor ID numbers, newer signed texts); otherwise nothing is changed and
 * the exit code is 1. Encrypting with another key could not be undone by a
 * later run. With nothing encrypted to check against, it refuses unless
 * `--unverified-key` is given.
 *
 * Idempotent: rows already encrypted are left alone, so running it again is
 * harmless. The SHA-256 evidence (of the plain text) is not changed. Until it
 * runs, the admin contract page shows legacy plain text with a warning. Prints
 * the counts; exit code 1 when a stored text does not match its SHA-256 (it is
 * encrypted all the same: look at those contracts).
 *
 * The UPDATE leaves the old row versions, with the plain text, in the table
 * files: after encrypting, the script runs `VACUUM (FULL, ANALYZE) contracts`
 * to rewrite the table (it needs the table owner; otherwise it prints the
 * command to run as the owner). WAL archives and database backups taken
 * before the run still hold the plain texts until they expire: see
 * "Encrypting older signed contract texts (once)" in docs/DEVELOPMENT.md.
 */
import { config } from "dotenv"

import Module, { createRequire } from "node:module"

const USAGE = "usage: pnpm contracts:encrypt [--dry-run] [--unverified-key]"
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const unverifiedKey = args.includes("--unverified-key")
const keyFromEnvFile = !process.env.ENCRYPTION_KEY
config({ quiet: true })

// The app's server modules import "server-only", which throws outside React
// Server Components; mark it as already loaded (empty), as scripts/jobs.ts does.
const load = createRequire(__filename)
const marker = load.resolve("server-only")
load.cache[marker] = Object.assign(new Module(marker), { filename: marker, loaded: true, exports: {} })

const log = (message: string) => console.info(`[contracts:encrypt] ${message}`)

async function main() {
  const unknown = args.filter((a) => a !== "--dry-run" && a !== "--unverified-key")
  if (unknown.length) {
    console.error(`[contracts:encrypt] unknown option ${unknown.join(" ")}\n${USAGE}`)
    process.exitCode = 1
    return
  }
  const { encryptLegacySignedTexts, SignedTextKeyError } = await import("../src/features/contracts/signed-text")
  const { db } = await import("../src/db")
  const { errorForLog } = await import("../src/lib/errors")
  const { sql } = await import("drizzle-orm")
  if (keyFromEnvFile && process.env.ENCRYPTION_KEY) log("ENCRYPTION_KEY is not set in the environment: using the one from .env")
  try {
    const result = await encryptLegacySignedTexts(db, { dryRun, unverifiedKey })
    log(
      dryRun
        ? `dry run: ${result.found} plain-text signed contract(s) to encrypt, the key decrypts the app's data; nothing changed`
        : `${result.encrypted} of ${result.found} plain-text signed contract(s) encrypted`,
    )
    if (result.hashMismatch.length) {
      console.warn(`[contracts:encrypt] text does not match its SHA-256: ${result.hashMismatch.join(", ")}`)
      process.exitCode = 1
    }
    if (!dryRun && result.encrypted > 0) {
      // Rewrite the table so the old row versions (with the plain text) leave its files.
      const [{ owner }] = (
        await db.execute<{ owner: boolean }>(sql`
          select pg_has_role(c.relowner, 'USAGE') or pg_has_role(d.datdba, 'USAGE') as owner
          from pg_class c, pg_database d
          where c.oid = 'contracts'::regclass and d.datname = current_database()`)
      ).rows
      if (owner) {
        await db.execute(sql`vacuum (full, analyze) contracts`)
        log("old plain-text row versions removed (VACUUM FULL contracts)")
      } else {
        console.warn(
          "[contracts:encrypt] the old row versions still hold the plain texts: run `VACUUM (FULL, ANALYZE) contracts;` as the table owner",
        )
        process.exitCode = 1
      }
    }
  } catch (err) {
    if (err instanceof SignedTextKeyError) {
      console.error(
        err.reason === "mismatch"
          ? "[contracts:encrypt] ENCRYPTION_KEY does not decrypt the app's encrypted data (instructor ID numbers, signed texts), so it is not the app's key. Nothing was changed. Run it with the app's ENCRYPTION_KEY."
          : "[contracts:encrypt] there is no encrypted data to check ENCRYPTION_KEY against. Nothing was changed. If it is certainly the app's key, run again with --unverified-key.",
      )
    } else {
      console.error("[contracts:encrypt] failed", errorForLog(err))
    }
    process.exitCode = 1
  } finally {
    await db.$client.end()
  }
}

void main()
