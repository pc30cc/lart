import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { auditLog, sessions } from "@/db/schema"
import { endImpersonationAction, instructorLogoutAction, memberLogoutAction } from "@/features/accounts/actions"
import { createAdmin, createInstructor, createMember, runId } from "@/features/workshops/test-fixtures"
import { adminLogoutAction } from "./actions"
import { sessionCookieName } from "./cookies"
import { getInstructor } from "./instructor"
import { getMember } from "./member"
import { createSession, IMPERSONATION_MS, startImpersonation } from "./session"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    auth: (await import("../../../messages/en/auth.json")).default,
    account: (await import("../../../messages/en/account.json")).default,
    instructors: (await import("../../../messages/en/instructors.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})

/** One browser: its cookies (with the options they were set with) and the work scheduled with after(). */
const browser = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  options: new Map<string, Record<string, unknown>>(),
  afterTasks: [] as Promise<unknown>[],
}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.20", "x-pathname": "/en/account" }),
  cookies: async () => ({
    get: (name: string) => (browser.cookies.has(name) ? { name, value: browser.cookies.get(name) } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      browser.options.set(name, options ?? {})
      if (value) browser.cookies.set(name, value)
      else browser.cookies.delete(name)
    },
  }),
}))
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => browser.afterTasks.push(Promise.resolve().then(task)),
}))
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

beforeEach(() => {
  browser.cookies.clear()
  browser.options.clear()
  browser.afterTasks = []
})

const cookie = (kind: "admin" | "instructor" | "member") => browser.cookies.get(sessionCookieName(kind))
const row = async (id: string) => (await db.select().from(sessions).where(eq(sessions.id, id)))[0]
const redirectTo = (path: string) => ({ digest: expect.stringContaining(`;${path};`) })
const ends = (subjectId: string, kind: "member" | "instructor") =>
  db
    .select({ adminId: auditLog.adminId, data: auditLog.data })
    .from(auditLog)
    .where(and(eq(auditLog.action, `${kind}.impersonate_end`), eq(auditLog.entityId, subjectId)))

async function signIn(kind: "admin" | "instructor" | "member", id: string) {
  const session = await createSession(kind, id)
  browser.cookies.set(sessionCookieName(kind), session.token)
  return session
}

describe("startImpersonation", () => {
  it("replaces this browser's session of that kind with a one-hour one, and leaves the admin cookie alone", async () => {
    const run = runId()
    const [admin, member] = await Promise.all([createAdmin(run, "Mina"), createMember(run, "Ayşe")])
    const adminSession = await signIn("admin", admin.id)
    const own = await signIn("member", member.id) // the admin's own test account, say

    const started = await startImpersonation("member", member.id, admin.id)
    expect(started.replaced).toEqual({ subjectId: member.id, impersonatedBy: null })
    expect(await row(own.id)).toBeUndefined()
    expect(cookie("member")).toBe(started.token)
    expect(browser.options.get(sessionCookieName("member"))).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: IMPERSONATION_MS / 1000,
    })
    expect(cookie("admin")).toBe(adminSession.token)
    expect(await row(adminSession.id)).toBeDefined()

    const stored = await row(started.id)
    expect(stored).toMatchObject({ kind: "member", subjectId: member.id, impersonatedBy: admin.id })
    expect(stored!.expiresAt.getTime() - stored!.createdAt.getTime()).toBe(IMPERSONATION_MS)

    // getMember() tells the server who is viewing (only server code sees the id).
    expect(await getMember()).toMatchObject({ member: { id: member.id }, impersonatedBy: { id: admin.id, name: "Mina" } })

    // Another viewing replaces this one and says which one it ended.
    const again = await startImpersonation("member", member.id, admin.id)
    expect(again.replaced).toEqual({ subjectId: member.id, impersonatedBy: admin.id })
    expect(await row(started.id)).toBeUndefined()
  })

  it("getInstructor() exposes the viewing admin too", async () => {
    const run = runId()
    const [admin, instructor] = await Promise.all([createAdmin(run, "Mina"), createInstructor(run)])
    await startImpersonation("instructor", instructor.id, admin.id)
    expect(await getInstructor()).toMatchObject({
      instructor: { id: instructor.id },
      impersonatedBy: { id: admin.id, name: "Mina" },
    })
  })
})

describe("endImpersonationAction (the bar's End)", () => {
  it("ends the viewing session without the admin's cookie, audits it as the admin and goes back to the admin page", async () => {
    const run = runId()
    const [admin, member] = await Promise.all([createAdmin(run), createMember(run)])
    const viewing = await startImpersonation("member", member.id, admin.id)
    expect(cookie("admin")).toBeUndefined()

    await expect(endImpersonationAction({ kind: "member", id: member.id })).rejects.toMatchObject(
      redirectTo(`/en/admin/students/${member.id}`),
    )
    expect(await row(viewing.id)).toBeUndefined()
    expect(cookie("member")).toBeUndefined()
    expect(await ends(member.id, "member")).toEqual([{ adminId: admin.id, data: { reason: "end" } }])
  })

  it("never ends a person's own session", async () => {
    const member = await createMember(runId())
    const own = await signIn("member", member.id)
    await expect(endImpersonationAction({ kind: "member", id: member.id })).rejects.toMatchObject(redirectTo("/en/account"))
    expect(await row(own.id)).toBeDefined()
    expect(cookie("member")).toBe(own.token)
    expect(await ends(member.id, "member")).toEqual([])
  })

  it("after the hour: clears the stale cookie and goes back to the person's page given", async () => {
    const run = runId()
    const [admin, instructor] = await Promise.all([createAdmin(run), createInstructor(run)])
    const old = await createSession("instructor", instructor.id, new Date(Date.now() - IMPERSONATION_MS - 1000), {
      impersonatedBy: admin.id,
    })
    browser.cookies.set(sessionCookieName("instructor"), old.token)
    await expect(endImpersonationAction({ kind: "instructor", id: instructor.id })).rejects.toMatchObject(
      redirectTo(`/en/admin/instructors/${instructor.id}`),
    )
    expect(cookie("instructor")).toBeUndefined()
    expect(await row(old.id)).toBeUndefined()
  })

  it("refuses anything but an instructor or member and a uuid", async () => {
    expect(await endImpersonationAction({ kind: "admin" as never, id: randomUUID() })).toMatchObject({ ok: false })
    expect(await endImpersonationAction({ kind: "member", id: "x" })).toMatchObject({ ok: false })
  })
})

describe("logging out while viewing", () => {
  it("the member's Log out ends the viewing and returns to the admin page", async () => {
    const run = runId()
    const [admin, member] = await Promise.all([createAdmin(run), createMember(run)])
    const viewing = await startImpersonation("member", member.id, admin.id)
    await expect(memberLogoutAction()).rejects.toMatchObject(redirectTo(`/en/admin/students/${member.id}`))
    expect(await row(viewing.id)).toBeUndefined()
    expect(await ends(member.id, "member")).toEqual([{ adminId: admin.id, data: { reason: "logout" } }])
  })

  it("the instructor's Log out too", async () => {
    const run = runId()
    const [admin, instructor] = await Promise.all([createAdmin(run), createInstructor(run)])
    const viewing = await startImpersonation("instructor", instructor.id, admin.id)
    await expect(instructorLogoutAction()).rejects.toMatchObject(redirectTo(`/en/admin/instructors/${instructor.id}`))
    expect(await row(viewing.id)).toBeUndefined()
    expect(await ends(instructor.id, "instructor")).toEqual([{ adminId: admin.id, data: { reason: "logout" } }])
  })

  it("a person's own Log out stays as it was", async () => {
    const member = await createMember(runId())
    const own = await signIn("member", member.id)
    await expect(memberLogoutAction()).rejects.toMatchObject(redirectTo("/en/workshops?notice=signedOut"))
    expect(await row(own.id)).toBeUndefined()
    expect(await ends(member.id, "member")).toEqual([])
  })
})

describe("adminLogoutAction", () => {
  it("ends every session the admin opened as someone, in every browser, and no one else's", async () => {
    const run = runId()
    const [mina, ali, member, instructor] = await Promise.all([
      createAdmin(run, "Mina"),
      createAdmin(run, "Ali"),
      createMember(run),
      createInstructor(run),
    ])
    // Two other browsers where Mina views as the member and the instructor; Ali views as the member.
    const a = await createSession("member", member.id, new Date(), { impersonatedBy: mina.id })
    const b = await createSession("instructor", instructor.id, new Date(), { impersonatedBy: mina.id })
    const c = await createSession("member", member.id, new Date(), { impersonatedBy: ali.id })
    const own = await createSession("member", member.id)

    const adminSession = await signIn("admin", mina.id)
    await expect(adminLogoutAction()).rejects.toMatchObject(redirectTo("/en/admin/login"))
    expect(await row(adminSession.id)).toBeUndefined()
    expect(await row(a.id)).toBeUndefined()
    expect(await row(b.id)).toBeUndefined()
    expect(await row(c.id)).toBeDefined()
    expect(await row(own.id)).toBeDefined()
    expect(await db.select().from(sessions).where(eq(sessions.impersonatedBy, mina.id))).toEqual([])
    expect(await ends(member.id, "member")).toEqual([{ adminId: mina.id, data: { reason: "admin_logout" } }])
    expect(await ends(instructor.id, "instructor")).toEqual([{ adminId: mina.id, data: { reason: "admin_logout" } }])
  })
})
