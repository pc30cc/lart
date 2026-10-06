import { randomUUID } from "node:crypto"
import { hash } from "@node-rs/argon2"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { db } from "@/db"
import { admins } from "@/db/schema"
import { LOCKOUT, verifyCredentials } from "./login"
import { hashPassword, needsRehash } from "./password"
import { createRateLimiter } from "./rate-limit"

const PASSWORD = "a long and lovely password"
let passwordHash: string

async function newAdmin(values: Partial<typeof admins.$inferInsert> = {}) {
  const email = `login-${randomUUID()}@test.local`
  const [row] = await db
    .insert(admins)
    .values({ email, name: "Test", passwordHash, ...values })
    .returning({ id: admins.id, email: admins.email })
  return row
}

const account = async (id: string) => (await db.select().from(admins).where(eq(admins.id, id)))[0]

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})

describe("verifyCredentials", () => {
  it("accepts the right password, case-insensitive email", async () => {
    const a = await newAdmin()
    expect(await verifyCredentials("admin", `  ${a.email.toUpperCase()} `, PASSWORD)).toEqual({ ok: true, id: a.id })
  })

  it("gives the same answer for unknown, inactive and wrong-password accounts", async () => {
    const inactive = await newAdmin({ active: false })
    const a = await newAdmin()
    expect(await verifyCredentials("admin", "nobody@test.local", PASSWORD)).toEqual({ ok: false, reason: "invalid" })
    expect(await verifyCredentials("admin", inactive.email, PASSWORD)).toEqual({ ok: false, reason: "invalid" })
    expect(await verifyCredentials("admin", a.email, "wrong password")).toMatchObject({ ok: false, reason: "invalid" })
  })

  it(`locks the account for ${LOCKOUT.lockMs / 60_000} minutes after ${LOCKOUT.maxFailures} wrong passwords`, async () => {
    const a = await newAdmin()
    const now = new Date()
    for (let i = 1; i < LOCKOUT.maxFailures; i++) {
      expect(await verifyCredentials("admin", a.email, "wrong", now)).toMatchObject({ ok: false, reason: "invalid" })
    }
    expect((await account(a.id)).failedLogins).toBe(LOCKOUT.maxFailures - 1)

    const last = await verifyCredentials("admin", a.email, "wrong", now)
    expect(last).toMatchObject({ ok: false, reason: "locked", lockedNow: true, id: a.id })
    const locked = await account(a.id)
    expect(locked.failedLogins).toBe(0)
    expect(locked.lockedUntil?.getTime()).toBe(now.getTime() + LOCKOUT.lockMs)

    // Even the right password is refused while locked.
    const during = new Date(now.getTime() + LOCKOUT.lockMs - 1000)
    expect(await verifyCredentials("admin", a.email, PASSWORD, during)).toMatchObject({ ok: false, reason: "locked" })

    // After the lock, the right password works and clears the counters.
    const after = new Date(now.getTime() + LOCKOUT.lockMs + 1000)
    expect(await verifyCredentials("admin", a.email, PASSWORD, after)).toEqual({ ok: true, id: a.id })
    expect(await account(a.id)).toMatchObject({ failedLogins: 0, lockedUntil: null })
  })

  it("resets the failure count after a successful login", async () => {
    const a = await newAdmin()
    await verifyCredentials("admin", a.email, "wrong")
    await verifyCredentials("admin", a.email, "wrong")
    expect((await account(a.id)).failedLogins).toBe(2)
    await verifyCredentials("admin", a.email, PASSWORD)
    expect((await account(a.id)).failedLogins).toBe(0)
  })

  it("upgrades an old, weaker hash after a successful login", async () => {
    const weak = await hash(PASSWORD, { memoryCost: 4096, timeCost: 1, parallelism: 1 })
    const a = await newAdmin({ passwordHash: weak })
    expect(await verifyCredentials("admin", a.email, PASSWORD)).toMatchObject({ ok: true })
    const upgraded = (await account(a.id)).passwordHash
    expect(upgraded).not.toBe(weak)
    expect(needsRehash(upgraded)).toBe(false)
  })

  it("works for other principal kinds (instructors without a password yet are refused)", async () => {
    const email = `login-${randomUUID()}@test.local`
    expect(await verifyCredentials("member", email, PASSWORD)).toEqual({ ok: false, reason: "invalid" })
    expect(await verifyCredentials("instructor", email, PASSWORD)).toEqual({ ok: false, reason: "invalid" })
  })
})

describe("rate limiter", () => {
  it("allows `limit` attempts per window per key", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 })
    const t0 = 1_000_000
    expect([1, 2, 3].map(() => limiter.consume("ip-a", t0).ok)).toEqual([true, true, true])
    const blocked = limiter.consume("ip-a", t0 + 100)
    expect(blocked).toMatchObject({ ok: false, remaining: 0, retryAfterMs: 900 })
    expect(limiter.consume("ip-b", t0 + 100).ok).toBe(true)
    expect(limiter.consume("ip-a", t0 + 1000).ok).toBe(true)
  })

  it("can be reset for a key", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 })
    limiter.consume("k")
    expect(limiter.consume("k").ok).toBe(false)
    limiter.reset("k")
    expect(limiter.consume("k").ok).toBe(true)
  })
})
