import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "@/db"
import { admins, sessions } from "@/db/schema"
import { createAdmin, runId } from "@/features/workshops/test-fixtures"
import { sha256 } from "@/lib/crypto"
import {
  createSession,
  deleteImpersonationsBy,
  deleteSession,
  deleteSessionsOf,
  IMPERSONATION_MS,
  sessionPolicy,
  validateSession,
} from "./session"

const { idleMs, absoluteMs } = sessionPolicy.admin
const row = async (id: string) => (await db.select().from(sessions).where(eq(sessions.id, id)))[0]

describe("database sessions", () => {
  it("stores only the SHA-256 of the 256-bit token", async () => {
    const s = await createSession("admin", randomUUID())
    expect(Buffer.from(s.token, "base64url")).toHaveLength(32)
    expect(s.id).toBe(sha256(s.token))
    expect(await row(s.token)).toBeUndefined()
    expect((await row(s.id))?.kind).toBe("admin")
  })

  it("validates a token for its own kind only", async () => {
    const subject = randomUUID()
    const s = await createSession("admin", subject)
    expect(await validateSession("admin", s.token)).toMatchObject({ id: s.id, subjectId: subject })
    expect(await validateSession("member", s.token)).toBeNull()
    expect(await validateSession("admin", "not-a-real-token")).toBeNull()
    expect(await validateSession("admin", undefined)).toBeNull()
    expect(await validateSession("admin", "x".repeat(500))).toBeNull()
  })

  it("expires after the idle time and deletes the row", async () => {
    const start = new Date()
    const s = await createSession("admin", randomUUID(), start)
    expect(await validateSession("admin", s.token, new Date(start.getTime() + idleMs + 1000))).toBeNull()
    expect(await row(s.id)).toBeUndefined()
  })

  it("slides the expiry once less than half the idle window is left", async () => {
    const start = new Date()
    const s = await createSession("admin", randomUUID(), start)

    const early = new Date(start.getTime() + idleMs * 0.25)
    expect((await validateSession("admin", s.token, early))?.expiresAt.getTime()).toBe(s.expiresAt.getTime())

    const late = new Date(start.getTime() + idleMs * 0.75)
    const slid = await validateSession("admin", s.token, late)
    expect(slid?.expiresAt.getTime()).toBe(late.getTime() + idleMs)
    expect((await row(s.id))?.expiresAt.getTime()).toBe(late.getTime() + idleMs)
  })

  it("never outlives the absolute lifetime", async () => {
    const start = new Date(Date.now() - absoluteMs + 60_000) // one minute of life left
    const s = await createSession("admin", randomUUID(), start)
    // Keep it fresh: slide right before the hard end.
    await db.update(sessions).set({ expiresAt: new Date(Date.now() + 1000) }).where(eq(sessions.id, s.id))
    const slid = await validateSession("admin", s.token)
    expect(slid?.expiresAt.getTime()).toBe(start.getTime() + absoluteMs)
    expect(await validateSession("admin", s.token, new Date(start.getTime() + absoluteMs + 1))).toBeNull()
  })

  it("logout deletes the session; sign-out-everywhere deletes all of a subject's sessions", async () => {
    const subject = randomUUID()
    const a = await createSession("instructor", subject)
    const b = await createSession("instructor", subject)
    const other = await createSession("instructor", randomUUID())

    await deleteSession(a.id)
    expect(await validateSession("instructor", a.token)).toBeNull()
    expect(await validateSession("instructor", b.token)).not.toBeNull()

    await deleteSessionsOf("instructor", subject)
    expect(await validateSession("instructor", b.token)).toBeNull()
    expect(await validateSession("instructor", other.token)).not.toBeNull()
  })

  it("cleans up a subject's expired sessions when a new one starts", async () => {
    const subject = randomUUID()
    const old = await createSession("member", subject, new Date(Date.now() - sessionPolicy.member.idleMs - 60_000))
    await createSession("member", subject)
    expect(await row(old.id)).toBeUndefined()
  })
})

describe("sessions of a super admin viewing as someone", () => {
  it("last one hour from their start, store the admin and never slide", async () => {
    const admin = await createAdmin(runId(), "Mina")
    const start = new Date()
    const subject = randomUUID()
    const s = await createSession("instructor", subject, start, { impersonatedBy: admin.id })
    expect(s.expiresAt.getTime()).toBe(start.getTime() + IMPERSONATION_MS)
    expect((await row(s.id))?.impersonatedBy).toBe(admin.id)

    // At 50 minutes an instructor's own session (7 days idle) would slide to a week: this one stays.
    const later = new Date(start.getTime() + 50 * 60_000)
    expect(await validateSession("instructor", s.token, later)).toEqual({
      id: s.id,
      subjectId: subject,
      expiresAt: s.expiresAt,
      impersonatedBy: { id: admin.id, name: "Mina" },
    })
    expect((await row(s.id))?.expiresAt.getTime()).toBe(s.expiresAt.getTime())

    expect(await validateSession("instructor", s.token, new Date(start.getTime() + IMPERSONATION_MS + 1000))).toBeNull()
    expect(await row(s.id)).toBeUndefined()
  })

  it("end even when the row was pushed past the hour by hand", async () => {
    const admin = await createAdmin(runId())
    const start = new Date(Date.now() - IMPERSONATION_MS - 1000)
    const s = await createSession("member", randomUUID(), start, { impersonatedBy: admin.id })
    await db.update(sessions).set({ expiresAt: new Date(Date.now() + 60 * 60_000) }).where(eq(sessions.id, s.id))
    expect(await validateSession("member", s.token)).toBeNull()
    expect(await row(s.id)).toBeUndefined()
  })

  it("a person's own session says nobody is viewing", async () => {
    const s = await createSession("member", randomUUID())
    expect((await validateSession("member", s.token))?.impersonatedBy).toBeNull()
  })

  it("end when the admin is deactivated, and go with a deleted admin", async () => {
    const admin = await createAdmin(runId())
    const s = await createSession("member", randomUUID(), new Date(), { impersonatedBy: admin.id })
    await db.update(admins).set({ active: false }).where(eq(admins.id, admin.id))
    expect(await validateSession("member", s.token)).toBeNull()
    expect(await row(s.id)).toBeUndefined()

    // A fresh admin (no audit entries yet) can be deleted: their viewing sessions go too (ON DELETE CASCADE).
    const other = await createAdmin(runId())
    const t = await createSession("instructor", randomUUID(), new Date(), { impersonatedBy: other.id })
    await db.delete(admins).where(eq(admins.id, other.id))
    expect(await row(t.id)).toBeUndefined()
  })

  it("are never possible for an admin account", async () => {
    const admin = await createAdmin(runId())
    await expect(createSession("admin", admin.id, new Date(), { impersonatedBy: admin.id })).rejects.toThrow(
      "admin sessions cannot be impersonated",
    )
    // The database refuses one too (CHECK sessions_impersonation_kind).
    const insert = db.insert(sessions).values({
      id: sha256(randomUUID()),
      kind: "admin",
      subjectId: admin.id,
      expiresAt: new Date(Date.now() + 60_000),
      impersonatedBy: admin.id,
    })
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "sessions_impersonation_kind" } })
    // An instructor's or member's cookie never opens the admin area (the kind is part of the lookup).
    const viewing = await createSession("instructor", randomUUID(), new Date(), { impersonatedBy: admin.id })
    expect(await validateSession("admin", viewing.token)).toBeNull()
  })

  it("deleteImpersonationsBy ends only that admin's viewing sessions", async () => {
    const [mina, ali] = [await createAdmin(runId()), await createAdmin(runId())]
    const person = randomUUID()
    const own = await createSession("member", person)
    const a = await createSession("member", person, new Date(), { impersonatedBy: mina.id })
    const other = randomUUID()
    const b = await createSession("instructor", other, new Date(), { impersonatedBy: mina.id })
    const c = await createSession("member", person, new Date(), { impersonatedBy: ali.id })

    const ended = await deleteImpersonationsBy(mina.id)
    expect(ended).toHaveLength(2)
    expect(ended).toEqual(expect.arrayContaining([{ kind: "member", subjectId: person }, { kind: "instructor", subjectId: other }]))
    expect(await row(a.id)).toBeUndefined()
    expect(await row(b.id)).toBeUndefined()
    expect(await row(c.id)).toBeDefined()
    expect(await row(own.id)).toBeDefined()
  })
})
