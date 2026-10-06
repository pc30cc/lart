import { hash } from "@node-rs/argon2"
import { describe, expect, it } from "vitest"

import { dummyHash, hashPassword, needsRehash, verifyPassword } from "./password"

describe("password hashing", () => {
  it("hashes with Argon2id and verifies only the right password", async () => {
    const stored = await hashPassword("correct horse battery staple")
    expect(stored.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true)
    expect(await verifyPassword(stored, "correct horse battery staple")).toBe(true)
    expect(await verifyPassword(stored, "correct horse battery stapl")).toBe(false)
  })

  it("salts every hash", async () => {
    expect(await hashPassword("same password here")).not.toBe(await hashPassword("same password here"))
  })

  it("never throws on a malformed stored hash", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false)
    expect(await verifyPassword("", "anything")).toBe(false)
  })

  it("asks for a rehash when the parameters are weaker than today's", async () => {
    const weak = await hash("old password value", { memoryCost: 4096, timeCost: 1, parallelism: 1 })
    expect(needsRehash(weak)).toBe(true)
    expect(needsRehash(await hashPassword("new password value"))).toBe(false)
    expect(needsRehash("garbage")).toBe(true)
  })

  it("has a dummy hash that matches no real password", async () => {
    const d = await dummyHash()
    expect(d).toBe(await dummyHash())
    expect(await verifyPassword(d, "")).toBe(false)
  })
})
