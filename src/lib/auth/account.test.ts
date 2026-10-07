import { randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, auditLog, emailTokens, sessions } from "@/db/schema"
import { sendEmail } from "@/lib/email"
import { sha256 } from "@/lib/crypto"
import {
  changeAdminPassword,
  isAdminResetTokenValid,
  issueAdminResetToken,
  RESET_TOKEN_MS,
  resetAdminPassword,
  sendAdminResetLink,
} from "./account"
import { hashPassword, verifyPassword } from "./password"
import { createSession } from "./session"

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

const OLD = "the old and trusty password"
const NEW = "a brand new and longer password"
let oldHash: string

beforeAll(async () => {
  oldHash = await hashPassword(OLD)
})
beforeEach(() => vi.mocked(sendEmail).mockClear())

async function newAdmin(values: Partial<typeof admins.$inferInsert> = {}) {
  const [row] = await db
    .insert(admins)
    .values({ email: `account-${randomUUID()}@test.local`, name: "Account Tester", passwordHash: oldHash, ...values })
    .returning()
  return row
}

const account = async (id: string) => (await db.select().from(admins).where(eq(admins.id, id)))[0]
const sessionsOf = (id: string) =>
  db.select().from(sessions).where(and(eq(sessions.kind, "admin"), eq(sessions.subjectId, id)))
const lastAudit = async (id: string) =>
  (await db.select().from(auditLog).where(eq(auditLog.entityId, id)).orderBy(desc(auditLog.at)).limit(1))[0]

describe("changeAdminPassword", () => {
  it("refuses a wrong current password and changes nothing", async () => {
    const a = await newAdmin()
    await createSession("admin", a.id)
    expect(await changeAdminPassword(a.id, "not the password", NEW)).toBe(false)
    expect((await account(a.id)).passwordHash).toBe(oldHash)
    expect(await sessionsOf(a.id)).toHaveLength(1)
  })

  it("stores the new password, clears the lockout, ends every session and audits", async () => {
    const a = await newAdmin({ failedLogins: 3, lockedUntil: new Date(Date.now() + 60_000) })
    await createSession("admin", a.id)
    await createSession("admin", a.id)
    await issueAdminResetToken(a.id)

    expect(await changeAdminPassword(a.id, OLD, NEW)).toBe(true)
    const after = await account(a.id)
    expect(await verifyPassword(after.passwordHash, NEW)).toBe(true)
    expect(after).toMatchObject({ failedLogins: 0, lockedUntil: null })
    expect(await sessionsOf(a.id)).toHaveLength(0)
    expect(await db.select().from(emailTokens).where(eq(emailTokens.subjectId, a.id))).toHaveLength(0)
    expect(await lastAudit(a.id)).toMatchObject({ action: "auth.password_change", adminId: a.id, data: null })
  })
})

describe("password reset links", () => {
  it("stores only the hash of the token and replaces an unused one", async () => {
    const a = await newAdmin()
    const first = await issueAdminResetToken(a.id)
    const second = await issueAdminResetToken(a.id)
    const rows = await db.select().from(emailTokens).where(eq(emailTokens.subjectId, a.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: sha256(second), purpose: "reset_password", kind: "admin", usedAt: null })
    expect(await isAdminResetTokenValid(first)).toBe(false)
    expect(await isAdminResetTokenValid(second)).toBe(true)
  })

  it(`works for ${RESET_TOKEN_MS / 60_000} minutes, for active admins only`, async () => {
    const a = await newAdmin()
    const now = new Date()
    const token = await issueAdminResetToken(a.id, now)
    expect(await isAdminResetTokenValid(token, new Date(now.getTime() + RESET_TOKEN_MS - 1000))).toBe(true)
    expect(await isAdminResetTokenValid(token, new Date(now.getTime() + RESET_TOKEN_MS + 1000))).toBe(false)
    expect(await resetAdminPassword(token, NEW, new Date(now.getTime() + RESET_TOKEN_MS + 1000))).toBeNull()

    await db.update(admins).set({ active: false }).where(eq(admins.id, a.id))
    expect(await isAdminResetTokenValid(token, now)).toBe(false)
    expect(await resetAdminPassword(token, NEW, now)).toBeNull()
    expect((await account(a.id)).passwordHash).toBe(oldHash)
  })

  it("sets the new password once, signs out everywhere and audits", async () => {
    const a = await newAdmin({ failedLogins: 4 })
    await createSession("admin", a.id)
    const token = await issueAdminResetToken(a.id)

    expect(await resetAdminPassword(token, NEW)).toBe(a.id)
    const after = await account(a.id)
    expect(await verifyPassword(after.passwordHash, NEW)).toBe(true)
    expect(after.failedLogins).toBe(0)
    expect(await sessionsOf(a.id)).toHaveLength(0)
    expect(await lastAudit(a.id)).toMatchObject({ action: "auth.password_reset", adminId: a.id })

    // The link works only once.
    expect(await isAdminResetTokenValid(token)).toBe(false)
    expect(await resetAdminPassword(token, "yet another long password")).toBeNull()
    expect(await verifyPassword((await account(a.id)).passwordHash, NEW)).toBe(true)
  })

  it("refuses made-up and oversized tokens", async () => {
    expect(await isAdminResetTokenValid("nope")).toBe(false)
    expect(await isAdminResetTokenValid("x".repeat(500))).toBe(false)
    expect(await resetAdminPassword("", NEW)).toBeNull()
  })
})

describe("sendAdminResetLink", () => {
  it("emails a working link to an active admin (any letter case)", async () => {
    const a = await newAdmin()
    await sendAdminResetLink(` ${a.email.toUpperCase()} `, "fa")
    expect(sendEmail).toHaveBeenCalledOnce()
    const input = vi.mocked(sendEmail).mock.calls[0][0] as {
      to: string
      template: string
      props: { name: string; resetUrl: string }
      locale: string
    }
    expect(input).toMatchObject({ to: a.email, template: "password_reset", locale: "fa", props: { name: a.name } })
    const url = new URL(input.props.resetUrl, "http://localhost")
    expect(url.pathname).toBe("/fa/admin/reset")
    expect(await isAdminResetTokenValid(url.searchParams.get("token")!)).toBe(true)
    expect(await lastAudit(a.id)).toMatchObject({ action: "auth.password_reset_request", adminId: null })
  })

  it("sends nothing for unknown or inactive addresses", async () => {
    const inactive = await newAdmin({ active: false })
    await sendAdminResetLink("nobody-here@test.local", "en")
    await sendAdminResetLink(inactive.email, "en")
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await db.select().from(emailTokens).where(eq(emailTokens.subjectId, inactive.id))).toHaveLength(0)
  })
})
