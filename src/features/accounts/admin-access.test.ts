import { randomUUID } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { redirect } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { parseTableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { auditLog, emailTokens, instructors, members, sessions } from "@/db/schema"
import { impersonateInstructor, setInstructorPassword } from "@/features/instructors/actions"
import { listInstructors } from "@/features/instructors/queries"
import { instructorTable } from "@/features/instructors/schema"
import { impersonateMember, setStudentPassword } from "@/features/students/actions"
import { createAdmin, createInstructor, createMember, runId } from "@/features/workshops/test-fixtures"
import { audit } from "@/lib/audit"
import { requireAdmin } from "@/lib/auth/admin"
import { sessionCookieName } from "@/lib/auth/cookies"
import { hashPassword, verifyPassword } from "@/lib/auth/password"
import { createSession, IMPERSONATION_MS } from "@/lib/auth/session"
import { issueEmailToken } from "@/lib/auth/tokens"
import { sendEmail } from "@/lib/email"
import { generatePassword } from "./admin-access"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    admin: (await import("../../../messages/en/admin.json")).default,
    instructors: (await import("../../../messages/en/instructors.json")).default,
    students: (await import("../../../messages/en/students.json")).default,
    account: (await import("../../../messages/en/account.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))
/** The real audit(), which a test can make fail. */
const realAudit = vi.hoisted(() => ({ fn: undefined as unknown as typeof import("@/lib/audit").audit }))
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>()
  realAudit.fn = actual.audit
  return { ...actual, audit: vi.fn(actual.audit) }
})

/** The admin's browser: its cookies, with the options they were set with. */
const browser = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  options: new Map<string, Record<string, unknown>>(),
}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.30" }),
  cookies: async () => ({
    get: (name: string) => (browser.cookies.has(name) ? { name, value: browser.cookies.get(name) } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      browser.options.set(name, options ?? {})
      if (value) browser.cookies.set(name, value)
      else browser.cookies.delete(name)
    },
  }),
}))

const session = vi.hoisted(() => ({
  sessionId: "test",
  admin: { id: "", email: "", name: "Access Tester", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: vi.fn(async () => session), getAdmin: async () => session }))

const PASSWORD = "a long and lovely password"
const NEW = "the new one from the team"
const BLOCKED_INACTIVE = "This instructor is inactive. Activate them first, then change the password."

/** A fresh admin for every test (the password limit counts per admin). */
beforeEach(async () => {
  const admin = await createAdmin(runId(), "Mina")
  session.admin.id = admin.id
  session.admin.email = admin.email
  browser.cookies.clear()
  browser.options.clear()
  vi.mocked(sendEmail).mockClear()
  vi.mocked(sendEmail).mockImplementation(async () => ({ ok: true }))
  vi.mocked(audit).mockImplementation(realAudit.fn)
})

const sessionsOf = (kind: "member" | "instructor", id: string) =>
  db.select().from(sessions).where(and(eq(sessions.kind, kind), eq(sessions.subjectId, id)))
const tokensOf = (id: string) => db.select({ purpose: emailTokens.purpose }).from(emailTokens).where(eq(emailTokens.subjectId, id))
const auditOf = (action: string, id: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.entityId, id)))
const redirectTo = (path: string) => ({ digest: expect.stringContaining(`;${path};`) })

async function person(kind: "member" | "instructor", run = runId()) {
  const passwordHash = await hashPassword(PASSWORD)
  if (kind === "member") {
    const m = await createMember(run)
    await db
      .update(members)
      .set({ passwordHash, locale: "fa", failedLogins: 4, lockedUntil: new Date(Date.now() + 60_000) })
      .where(eq(members.id, m.id))
    return m.id
  }
  const i = await createInstructor(run)
  await db
    .update(instructors)
    .set({ passwordHash, locale: "en", failedLogins: 5, lockedUntil: new Date(Date.now() + 60_000) })
    .where(eq(instructors.id, i.id))
  return i.id
}

const hashOf = async (kind: "member" | "instructor", id: string) => {
  const table = kind === "member" ? members : instructors
  const [row] = await db
    .select({ hash: table.passwordHash, failed: table.failedLogins, locked: table.lockedUntil, verified: table.emailVerifiedAt })
    .from(table)
    .where(eq(table.id, id))
  return row
}

const setPassword = { member: setStudentPassword, instructor: setInstructorPassword } as const
const impersonate = { member: impersonateMember, instructor: impersonateInstructor } as const

describe.each(["member", "instructor"] as const)("setting a %s's password", (kind) => {
  it("stores a typed password, clears the lockout and ends every session and reset link (verify links stay)", async () => {
    const id = await person(kind)
    const other = await person(kind)
    const viewer = await createAdmin(runId())
    await createSession(kind, id)
    await createSession(kind, id, new Date(), { impersonatedBy: viewer.id })
    await createSession(kind, other)
    await issueEmailToken(kind, "reset_password", id, 60_000)
    await issueEmailToken(kind, "verify_email", id, 60_000)

    const result = await setPassword[kind]({ id, mode: "type", password: NEW })
    expect(result).toEqual({ ok: true, data: { emailed: true } })

    const row = await hashOf(kind, id)
    expect(await verifyPassword(row.hash!, NEW)).toBe(true)
    expect(row).toMatchObject({ failed: 0, locked: null, verified: null }) // the inbox was not proven
    expect(await sessionsOf(kind, id)).toEqual([])
    expect(await sessionsOf(kind, other)).toHaveLength(1)
    expect((await tokensOf(id)).map((t) => t.purpose)).toEqual(["verify_email"])

    const [entry] = await auditOf(`${kind}.password_set`, id)
    expect(entry).toMatchObject({ adminId: session.admin.id, entity: kind, data: { generated: false } })
    expect(JSON.stringify(entry)).not.toContain(NEW)

    expect(sendEmail).toHaveBeenCalledOnce()
    const [email] = vi.mocked(sendEmail).mock.calls[0]
    expect(email).toMatchObject({
      template: "password_changed_by_team",
      locale: kind === "member" ? "fa" : "en",
      props: {
        loginUrl: expect.stringMatching(kind === "member" ? /\/fa\/account\/login$/ : /\/en\/instructor\/login$/),
      },
    })
    expect(JSON.stringify(email)).not.toContain(NEW)
  })

  it("generates a strong password, returns it once and stores only its hash", async () => {
    const id = await person(kind)
    const result = await setPassword[kind]({ id, mode: "generate" })
    if (!result.ok) throw new Error(result.error)
    const { password, emailed } = result.data
    expect(emailed).toBe(true)
    expect(password).toMatch(/^[a-hjkmnp-zA-HJ-NP-Z2-9]{4}(-[a-hjkmnp-zA-HJ-NP-Z2-9]{4}){3}$/)
    const row = await hashOf(kind, id)
    expect(row.hash).not.toContain(password!)
    expect(await verifyPassword(row.hash!, password!)).toBe(true)
    const [entry] = await auditOf(`${kind}.password_set`, id)
    expect(entry.data).toEqual({ generated: true })
    expect(JSON.stringify(entry)).not.toContain(password!)
  })

  it("says when the email could not be sent; the password is changed all the same", async () => {
    const id = await person(kind)
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "down" })
    expect(await setPassword[kind]({ id, mode: "type", password: NEW })).toEqual({ ok: true, data: { emailed: false } })
    expect(await verifyPassword((await hashOf(kind, id)).hash!, NEW)).toBe(true)
  })

  it("checks the person's own password rules and an unknown id", async () => {
    const id = await person(kind)
    expect(await setPassword[kind]({ id, mode: "type", password: "short" })).toMatchObject({
      ok: false,
      fieldErrors: { password: expect.any(String) },
    })
    expect(await verifyPassword((await hashOf(kind, id)).hash!, PASSWORD)).toBe(true)
    expect(await setPassword[kind]({ id: randomUUID(), mode: "generate" })).toEqual({
      ok: false,
      error: kind === "member" ? "This student no longer exists." : expect.stringContaining("This instructor no longer exists"),
    })
  })

  it("is for signed-in super admins only", async () => {
    const id = await person(kind)
    vi.mocked(requireAdmin).mockImplementationOnce(async () => redirect("/en/admin/login"))
    await expect(setPassword[kind]({ id, mode: "type", password: NEW })).rejects.toMatchObject(redirectTo("/en/admin/login"))
    expect(await verifyPassword((await hashOf(kind, id)).hash!, PASSWORD)).toBe(true)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe("setting an instructor's password", () => {
  it("refuses a deactivated instructor", async () => {
    const i = await createInstructor(runId(), { active: false })
    expect(await setInstructorPassword({ id: i.id, mode: "type", password: NEW })).toEqual({ ok: false, error: BLOCKED_INACTIVE })
    expect((await hashOf("instructor", i.id)).hash).toBeNull()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("completes an invited instructor's account: the invitation is used up and the list says active", async () => {
    const i = await createInstructor(runId()) // invited: no password yet
    await issueEmailToken("instructor", "invite", i.id, 60_000)
    expect((await setInstructorPassword({ id: i.id, mode: "type", password: NEW })).ok).toBe(true)
    expect(await tokensOf(i.id)).toEqual([])
    const [entry] = await auditOf("instructor.password_set", i.id)
    expect(entry.data).toEqual({ generated: false, inviteCompleted: true })
    const params = parseTableParams({ q: i.email }, { sort: instructorTable.sort, defaultSort: "name", filters: instructorTable.filters })
    const { rows } = await listInstructors(params, "en")
    expect(rows).toMatchObject([{ id: i.id, hasPassword: true }])
  })
})

describe("the password limit", () => {
  it("allows 10 per admin per 15 minutes, both kinds together, before any hashing", async () => {
    for (let n = 0; n < 10; n++) {
      const action = n % 2 ? setStudentPassword : setInstructorPassword
      expect((await action({ id: randomUUID(), mode: "generate" })).ok).toBe(false) // unknown: not found, but counted
    }
    const over = await setStudentPassword({ id: randomUUID(), mode: "generate" })
    expect(over).toEqual({
      ok: false,
      error: "You’ve changed many passwords in a short time. Please wait a few minutes and try again.",
    })
    // Another admin is not limited.
    session.admin.id = (await createAdmin(runId())).id
    const id = await person("member")
    expect((await setStudentPassword({ id, mode: "type", password: NEW })).ok).toBe(true)
  })
})

describe("generatePassword", () => {
  it("gives 16 random characters from 55 unambiguous ones in groups of four (more than 90 bits)", () => {
    const all = Array.from({ length: 200 }, generatePassword)
    expect(new Set(all).size).toBe(200)
    for (const p of all) {
      expect(p).toHaveLength(19)
      expect(p).toMatch(/^[a-hjkmnp-zA-HJ-NP-Z2-9]{4}(-[a-hjkmnp-zA-HJ-NP-Z2-9]{4}){3}$/)
    }
    expect(16 * Math.log2(55)).toBeGreaterThanOrEqual(90)
  })
})

describe.each(["member", "instructor"] as const)("entering a %s's panel", (kind) => {
  it("starts a one-hour session as them in this browser, audits it and opens their area", async () => {
    const id = await person(kind)
    const adminCookie = sessionCookieName("admin")
    browser.cookies.set(adminCookie, "the-admins-own")

    await expect(impersonate[kind]({ id })).rejects.toMatchObject(redirectTo(kind === "member" ? "/en/account" : "/en/instructor"))

    const name = sessionCookieName(kind)
    expect(browser.options.get(name)).toMatchObject({ maxAge: IMPERSONATION_MS / 1000, httpOnly: true, sameSite: "lax", path: "/" })
    expect(browser.cookies.get(adminCookie)).toBe("the-admins-own")
    const [row] = await sessionsOf(kind, id)
    expect(row.impersonatedBy).toBe(session.admin.id)
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(IMPERSONATION_MS)
    expect(await auditOf(`${kind}.impersonate`, id)).toMatchObject([{ adminId: session.admin.id, entity: kind }])
  })

  it("replacing an earlier viewing in this browser ends it with reason 'replaced'", async () => {
    const [first, second] = [await person(kind), await person(kind)]
    await expect(impersonate[kind]({ id: first })).rejects.toMatchObject({ digest: expect.any(String) })
    await expect(impersonate[kind]({ id: second })).rejects.toMatchObject({ digest: expect.any(String) })
    expect(await sessionsOf(kind, first)).toEqual([])
    expect(await auditOf(`${kind}.impersonate_end`, first)).toMatchObject([
      { adminId: session.admin.id, data: { reason: "replaced" } },
    ])
    expect(await sessionsOf(kind, second)).toHaveLength(1)
  })

  it("starts nothing when its audit entry cannot be written: no session, no cookie, the earlier viewing stays", async () => {
    const [first, second] = [await person(kind), await person(kind)]
    await expect(impersonate[kind]({ id: first })).rejects.toMatchObject({ digest: expect.any(String) })
    const name = sessionCookieName(kind)
    const firstCookie = browser.cookies.get(name)
    browser.options.clear()
    vi.mocked(audit).mockImplementation(async (entry, tx) => {
      if (entry.action === `${kind}.impersonate`) throw new Error("connection lost")
      return realAudit.fn(entry, tx)
    })
    vi.spyOn(console, "error").mockImplementationOnce(() => {})

    expect(await impersonate[kind]({ id: second })).toEqual({
      ok: false,
      error: expect.stringContaining("Something went wrong"),
    })
    expect(browser.options.has(name)).toBe(false) // no Set-Cookie
    expect(browser.cookies.get(name)).toBe(firstCookie)
    expect(await sessionsOf(kind, second)).toEqual([])
    expect(await sessionsOf(kind, first)).toMatchObject([{ impersonatedBy: session.admin.id }]) // the delete rolled back
    expect(await auditOf(`${kind}.impersonate_end`, first)).toEqual([]) // rolled back with it
    expect(await auditOf(`${kind}.impersonate`, second)).toEqual([])
  })

  it("is for signed-in super admins only, and not for an unknown id", async () => {
    const id = await person(kind)
    vi.mocked(requireAdmin).mockImplementationOnce(async () => redirect("/en/admin/login"))
    await expect(impersonate[kind]({ id })).rejects.toMatchObject(redirectTo("/en/admin/login"))
    expect(await impersonate[kind]({ id: randomUUID() })).toMatchObject({ ok: false })
    expect(await sessionsOf(kind, id)).toEqual([])
  })
})

describe("entering a deactivated instructor's panel", () => {
  it("is refused", async () => {
    const i = await createInstructor(runId(), { active: false })
    expect(await impersonateInstructor({ id: i.id })).toEqual({
      ok: false,
      error: "This instructor is inactive, so you can’t enter their panel. Activate them first.",
    })
    expect(await sessionsOf("instructor", i.id)).toEqual([])
    expect(browser.cookies.size).toBe(0)
    expect(
      await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, i.id), inArray(auditLog.action, ["instructor.impersonate"]))),
    ).toEqual([])
  })
})
