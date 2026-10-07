import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { auditLog, members, registrations } from "@/db/schema"
import { createAdmin, createMember, runId } from "@/features/workshops/test-fixtures"
import type { MemberSession } from "@/lib/auth/member"
import { registerAction, saveProfileAction } from "./actions"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    account: (await import("../../../messages/en/account.json")).default,
    registration: (await import("../../../messages/en/registration.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.40" }) }))
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

/** The signed-in member (a real row), and the super admin viewing as them, if any. */
const signedIn = vi.hoisted(() => ({
  member: null as MemberSession["member"] | null,
  viewer: null as { id: string; name: string } | null,
}))
vi.mock("@/lib/auth/member", () => {
  const session = (): MemberSession => ({ sessionId: "test", member: signedIn.member!, impersonatedBy: signedIn.viewer })
  return { requireMember: async () => session(), getMember: async () => session() }
})

const run = runId()
const BLOCKED = "This can’t be done while you’re viewing as this person. Only they can do it themselves."

beforeEach(async () => {
  const m = await createMember(run, "Ayşe Demir")
  signedIn.member = { id: m.id, email: m.email, name: m.name, phone: null, locale: "tr", emailVerified: true }
  signedIn.viewer = null
})

describe("while a super admin views as the member", () => {
  it("registering (terms and consents) is refused and nothing is stored", async () => {
    const admin = await createAdmin(run)
    signedIn.viewer = { id: admin.id, name: "Mina" }
    const result = await registerAction({
      courseId: randomUUID(),
      locale: "en",
      participantName: "Ayşe Demir",
      termsSha256: "a".repeat(64),
      acceptTerms: true,
      photoConsent: true,
      videoConsent: false,
    })
    expect(result).toEqual({ ok: false, error: BLOCKED })
    expect(await db.select().from(registrations).where(eq(registrations.memberId, signedIn.member!.id))).toEqual([])
  })

  it("'My details' saves and is audited as the admin (field names only)", async () => {
    const admin = await createAdmin(run)
    signedIn.viewer = { id: admin.id, name: "Mina" }
    const id = signedIn.member!.id
    expect(await saveProfileAction({ name: "Ayşe Demir", phone: "0532 111 22 33", locale: "tr" })).toEqual({
      ok: true,
      data: undefined,
    })
    const [row] = await db.select({ phone: members.phone }).from(members).where(eq(members.id, id))
    expect(row.phone).toBe("05321112233")
    const entries = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "member.profile_update"), eq(auditLog.entityId, id)))
    expect(entries).toMatchObject([
      { adminId: admin.id, entity: "member", data: { by: "member", fields: ["phone"], impersonatedBy: admin.id } },
    ])
    expect(JSON.stringify(entries)).not.toContain("05321112233")
  })

  it("the member's own changes write no audit entry", async () => {
    const id = signedIn.member!.id
    expect((await saveProfileAction({ name: "Ayşe D", phone: "", locale: "en" })).ok).toBe(true)
    expect(await db.select().from(auditLog).where(eq(auditLog.entityId, id))).toEqual([])
  })
})
