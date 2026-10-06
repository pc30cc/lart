/**
 * Password hashing with Argon2id (the library default algorithm).
 * No "server-only" import so `scripts/create-admin.ts` can use it outside Next.
 */
import { hash, parseOptions, verify } from "@node-rs/argon2"

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./schemas"

/** OWASP baseline for Argon2id: 19 MiB memory, 2 passes, 1 lane. */
const params = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, params)
}

/** Never throws: a malformed stored hash simply does not verify. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password)
  } catch {
    return false
  }
}

/** True when a stored hash was made with weaker or different parameters than today's. */
export function needsRehash(stored: string): boolean {
  try {
    const o = parseOptions(stored)
    return (
      !stored.startsWith("$argon2id$") ||
      o.memoryCost !== params.memoryCost ||
      o.timeCost !== params.timeCost ||
      o.parallelism !== params.parallelism
    )
  } catch {
    return true
  }
}

let dummy: Promise<string> | undefined

/**
 * A hash of a random secret. Verifying against it when an account does not
 * exist makes a login take the same time either way (no user enumeration).
 */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(crypto.randomUUID())
  return dummy
}
