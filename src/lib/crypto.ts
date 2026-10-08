import "server-only"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

import { env } from "@/lib/env"

const key = Buffer.from(env.ENCRYPTION_KEY, "base64")

/** AES-256-GCM. Output: "v1.<iv>.<tag>.<ciphertext>" in base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return ["v1", iv, tag, data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".")
}

/**
 * The shape of `encrypt` output, v1: 12-byte IV, 16-byte tag and the data, in
 * base64url. Also usable in PostgreSQL (`column ~ CIPHERTEXT_PATTERN`).
 */
export const CIPHERTEXT_PATTERN = "^v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]+$"
const ciphertext = new RegExp(CIPHERTEXT_PATTERN)

/** Whether a stored value looks like `encrypt` output (it may still fail to decrypt with another key). */
export const isCiphertext = (value: string) => ciphertext.test(value)

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(".")
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Invalid ciphertext")
  // The full 16-byte tag only: a shortened one would make a forged value far cheaper to find.
  const authTag = Buffer.from(tag, "base64url")
  if (authTag.length !== 16) throw new Error("Invalid ciphertext")
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: 16 })
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

/** A URL-safe random token with 256 bits of entropy. */
export const randomToken = () => randomBytes(32).toString("base64url")
