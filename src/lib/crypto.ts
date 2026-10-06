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

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(".")
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Invalid ciphertext")
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

/** A URL-safe random token with 256 bits of entropy. */
export const randomToken = () => randomBytes(32).toString("base64url")
