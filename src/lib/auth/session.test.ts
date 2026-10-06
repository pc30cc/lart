import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "@/db"
import { sessions } from "@/db/schema"
import { sha256 } from "@/lib/crypto"
import { createSession, deleteSession, deleteSessionsOf, sessionPolicy, validateSession } from "./session"

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
