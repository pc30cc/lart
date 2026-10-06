import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, sessions } from "@/db/schema"
import { sendEmail } from "@/lib/email"
import { issueAdminResetToken } from "./account"
import { changeAdminPasswordAction, requestAdminPasswordResetAction, resetAdminPasswordAction } from "./actions"
import { sessionCookieName } from "./cookies"
import { hashPassword, verifyPassword } from "./password"
import { createSession } from "./session"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    auth: (await import("../../../messages/en/auth.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})

const request = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  afterTasks: [] as Promise<unknown>[],
}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "2001:db8:1:2::7" }),
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name) } : undefined),
    set: (name: string, value: string) => request.cookies.set(name, value),
  }),
}))
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => request.afterTasks.push(Promise.resolve().then(task)),
}))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

const session = vi.hoisted(() => ({
  sessionId: "test",
  admin: { id: "", email: "", name: "Password Tester", shareBp: 0 },
}))
vi.mock("./admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const OLD = "the old and trusty password"
const NEW = "a brand new and longer password"

async function newAdmin() {
  const [row] = await db
    .insert(admins)
    .values({ email: `actions-${randomUUID()}@test.local`, name: "Password Tester", passwordHash: await hashPassword(OLD) })
    .returning()
  return row
}

const sessionsOf = (id: string) =>
  db.select().from(sessions).where(and(eq(sessions.kind, "admin"), eq(sessions.subjectId, id)))

beforeEach(() => {
  request.cookies.clear()
  request.afterTasks = []
  vi.mocked(sendEmail).mockClear()
})

describe("changeAdminPasswordAction", () => {
  let adminId: string
  beforeAll(async () => {
    const a = await newAdmin()
    adminId = session.admin.id = a.id
    session.admin.email = a.email
  })

  it("puts friendly messages on the right fields", async () => {
    expect(await changeAdminPasswordAction({ current: OLD, next: NEW, confirm: `${NEW}!` })).toMatchObject({
      ok: false,
      fieldErrors: { confirm: "The two new passwords don’t match." },
    })
    expect(await changeAdminPasswordAction({ current: OLD, next: "short", confirm: "short" })).toMatchObject({
      ok: false,
      fieldErrors: { next: "Please use at least 12 characters." },
    })
    expect(await changeAdminPasswordAction({ current: "wrong guess", next: NEW, confirm: NEW })).toEqual({
      ok: false,
      error: "That isn’t your current password.",
      fieldErrors: { current: "That isn’t your current password." },
    })
  })

  it("changes the password, signs out other devices and keeps this one signed in", async () => {
    const other = await createSession("admin", adminId)
    expect(await changeAdminPasswordAction({ current: OLD, next: NEW, confirm: NEW })).toEqual({
      ok: true,
      data: undefined,
    })
    const [stored] = await db.select().from(admins).where(eq(admins.id, adminId))
    expect(await verifyPassword(stored.passwordHash, NEW)).toBe(true)

    const remaining = await sessionsOf(adminId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).not.toBe(other.id)
    expect(request.cookies.get(sessionCookieName("admin"))).toBeTruthy()
  })
})

describe("requestAdminPasswordResetAction", () => {
  it("gives the same answer for known and unknown addresses, and emails only admins", async () => {
    const a = await newAdmin()
    expect(await requestAdminPasswordResetAction({ email: "nobody-at-all@test.local" })).toEqual({
      ok: true,
      data: undefined,
    })
    expect(await requestAdminPasswordResetAction({ email: a.email })).toEqual({ ok: true, data: undefined })
    await Promise.all(request.afterTasks)
    expect(sendEmail).toHaveBeenCalledOnce()
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({ to: a.email, template: "password_reset" })
  })

  it("asks for a valid address", async () => {
    expect(await requestAdminPasswordResetAction({ email: "not an email" })).toMatchObject({
      ok: false,
      fieldErrors: { email: "Please enter a valid email address." },
    })
  })
})

describe("resetAdminPasswordAction", () => {
  it("explains a dead link, and goes back to sign in after a reset", async () => {
    expect(await resetAdminPasswordAction({ token: "made-up", next: NEW, confirm: NEW })).toEqual({
      ok: false,
      error: "This link no longer works. Please ask for a new one.",
    })

    const a = await newAdmin()
    const token = await issueAdminResetToken(a.id)
    await expect(resetAdminPasswordAction({ token, next: NEW, confirm: NEW })).rejects.toMatchObject({
      digest: expect.stringContaining("/en/admin/login?reset=done"),
    })
    const [stored] = await db.select().from(admins).where(eq(admins.id, a.id))
    expect(await verifyPassword(stored.passwordHash, NEW)).toBe(true)
  })
})
