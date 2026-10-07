import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { instructors, members, sessions } from "@/db/schema"
import { encrypt } from "@/lib/crypto"
import { sessionCookieName } from "./cookies"
import { getInstructor, requireInstructor, requireInstructorApi } from "./instructor"
import { LOCKOUT, verifyCredentials } from "./login"
import { getMember, requireMember, requireMemberApi } from "./member"
import { hashPassword } from "./password"
import { createSession } from "./session"

vi.mock("next-intl/server", () => ({ getLocale: async () => "fa" }))

const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), path: "/fa/workshops/candles?x=1" }))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-pathname": request.path }),
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name) } : undefined),
  }),
}))

const PASSWORD = "a long and lovely password"
let passwordHash: string

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})
beforeEach(() => {
  request.cookies.clear()
  request.path = "/fa/workshops/candles?x=1"
})

const address = (what: string) => `auth-${what}-${randomUUID().slice(0, 8)}@test.local`

async function newMember(values: Partial<typeof members.$inferInsert> = {}) {
  const [row] = await db
    .insert(members)
    .values({ email: address("member"), name: "Ayşe", phone: "+905321234567", passwordHash, locale: "en", ...values })
    .returning()
  return row
}

async function newInstructor(values: Partial<typeof instructors.$inferInsert> = {}) {
  const [row] = await db
    .insert(instructors)
    .values({
      email: address("instructor"),
      passwordHash,
      officialName: "Zeynep Yılmaz",
      idNumberEnc: encrypt("12345678901"),
      mobile: "+90 555 000 00 00",
      displayName: { tr: "Zeynep" },
      teachingField: { tr: "Mum" },
      ...values,
    })
    .returning()
  return row
}

async function signIn(kind: "member" | "instructor", id: string) {
  const session = await createSession(kind, id)
  request.cookies.set(sessionCookieName(kind), session.token)
  return session
}

const redirectTo = (path: string) => ({ digest: expect.stringContaining(`;${path};`) })

describe("members", () => {
  it("getMember returns the signed-in member (only what the site needs)", async () => {
    const m = await newMember({ emailVerifiedAt: new Date() })
    expect(await getMember()).toBeNull()
    const session = await signIn("member", m.id)
    expect(await getMember()).toEqual({
      sessionId: session.id,
      member: { id: m.id, email: m.email, name: "Ayşe", phone: "+905321234567", locale: "en", emailVerified: true },
      impersonatedBy: null,
    })
  })

  it("an admin's or instructor's cookie is not a member session", async () => {
    const i = await newInstructor()
    const { token } = await createSession("instructor", i.id)
    request.cookies.set(sessionCookieName("member"), token)
    expect(await getMember()).toBeNull()
  })

  it("requireMember sends a visitor to the login, coming back to the current page", async () => {
    await expect(requireMember()).rejects.toMatchObject(
      redirectTo(`/fa/account/login?next=${encodeURIComponent("/fa/workshops/candles?x=1")}`),
    )
    await expect(requireMember("/fa/account")).rejects.toMatchObject(
      redirectTo(`/fa/account/login?next=${encodeURIComponent("/fa/account")}`),
    )
    request.path = "https://evil.example/fa"
    await expect(requireMember()).rejects.toMatchObject(redirectTo("/fa/account/login"))
  })

  it("requireMember comes back to the page's address today, not to the main language's old prefix (R1)", async () => {
    // A tab opened with the main language's prefix (tr here) posts a server action there.
    request.path = "/tr/workshops/candles?x=1"
    await expect(requireMember()).rejects.toMatchObject(
      redirectTo(`/fa/account/login?next=${encodeURIComponent("/workshops/candles?x=1")}`),
    )
  })

  it("requireMemberApi refuses a cross-site POST even with a session", async () => {
    const m = await newMember()
    await signIn("member", m.id)
    const post = (origin: string) =>
      new Request("http://localhost:3000/api/account/x", { method: "POST", headers: { origin, host: "localhost:3000" } })
    expect(await requireMemberApi(post("https://evil.example"))).toBeNull()
    expect((await requireMemberApi(post("http://localhost:3000")))?.member.id).toBe(m.id)
  })
})

describe("instructors", () => {
  it("getInstructor returns the active instructor, and ends a deactivated one's session", async () => {
    const i = await newInstructor({ locale: "fa" })
    const session = await signIn("instructor", i.id)
    expect(await getInstructor()).toMatchObject({
      sessionId: session.id,
      instructor: { id: i.id, email: i.email, locale: "fa", emailVerified: false },
    })

    await db.update(instructors).set({ active: false }).where(eq(instructors.id, i.id))
    expect(await getInstructor()).toBeNull()
    expect(await db.select().from(sessions).where(eq(sessions.id, session.id))).toHaveLength(0)
  })

  it("requireInstructor sends a visitor to the instructor login; a panel page comes back", async () => {
    request.path = "/fa/instructor/contracts"
    await expect(requireInstructor()).rejects.toMatchObject(
      redirectTo(`/fa/instructor/login?next=${encodeURIComponent("/fa/instructor/contracts")}`),
    )
    request.path = "/fa/workshops"
    await expect(requireInstructor()).rejects.toMatchObject(redirectTo("/fa/instructor/login"))
    request.path = "/tr/instructor/contracts?c=1"
    await expect(requireInstructor()).rejects.toMatchObject(
      redirectTo(`/fa/instructor/login?next=${encodeURIComponent("/instructor/contracts?c=1")}`),
    )
  })

  it("requireInstructorApi refuses a cross-site POST", async () => {
    const i = await newInstructor()
    await signIn("instructor", i.id)
    const post = new Request("http://localhost:3000/api/instructor/x", { method: "POST", headers: { origin: "https://evil.example" } })
    expect(await requireInstructorApi(post)).toBeNull()
  })
})

describe("verifyCredentials for members and instructors", () => {
  it("finds an instructor whatever the case of the stored email", async () => {
    const i = await newInstructor()
    await db.execute(sql`update instructors set email = upper(email) where id = ${i.id}`)
    expect(await verifyCredentials("instructor", i.email.toLowerCase(), PASSWORD)).toEqual({ ok: true, id: i.id })
  })

  it("never lets in a deactivated instructor or one without a password", async () => {
    const off = await newInstructor({ active: false })
    const invited = await newInstructor({ passwordHash: null })
    expect(await verifyCredentials("instructor", off.email, PASSWORD)).toEqual({ ok: false, reason: "invalid" })
    expect(await verifyCredentials("instructor", invited.email, PASSWORD)).toEqual({ ok: false, reason: "invalid" })
  })

  it(`locks a member out after ${LOCKOUT.maxFailures} wrong passwords`, async () => {
    const m = await newMember()
    for (let i = 1; i < LOCKOUT.maxFailures; i++) {
      expect(await verifyCredentials("member", m.email, "wrong")).toMatchObject({ ok: false, reason: "invalid" })
    }
    expect(await verifyCredentials("member", m.email, "wrong")).toMatchObject({ ok: false, reason: "locked", lockedNow: true })
    expect(await verifyCredentials("member", m.email, PASSWORD)).toMatchObject({ ok: false, reason: "locked" })
    const later = new Date(Date.now() + LOCKOUT.lockMs + 1000)
    expect(await verifyCredentials("member", m.email, PASSWORD, later)).toEqual({ ok: true, id: m.id })
  })
})
