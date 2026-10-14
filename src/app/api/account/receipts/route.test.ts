import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { courses, registrations } from "@/db/schema"
import {
  addRegistration,
  createAdmin,
  createCategory,
  createInstructor,
  createMember,
  createTermsTemplate,
  runId,
} from "@/features/workshops/test-fixtures"
import { sessionCookieName } from "@/lib/auth/cookies"
import { createSession } from "@/lib/auth/session"
import { env } from "@/lib/env"

/** One request's cookies (the real member session is looked up in the database). */
const state = vi.hoisted(() => ({ cookies: new Map<string, string>(), root: "" }))
// The admins' Telegram runs after the response: here it is only checked that it is asked for.
const telegram = vi.hoisted(() => ({ notifyAdmins: vi.fn(async () => {}) }))
vi.mock("@/features/telegram/admin-notices", () => telegram)
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "198.51.100.5" }),
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) } : undefined),
    set: () => {},
  }),
}))
vi.mock("@/lib/storage", async (original) => {
  const actual = await original<typeof import("@/lib/storage")>()
  const { localDriver } = await import("@/lib/storage/local")
  return { ...actual, getStorage: async () => actual.createStorage(localDriver(state.root)) }
})

const { POST } = await import("./route")

const run = runId()
const ORIGIN = new URL(env.APP_URL).origin
let memberId: string
let registrationId: string
let paidId: string

beforeAll(async () => {
  state.root = await mkdtemp(path.join(os.tmpdir(), "lart-receipt-upload-"))
  const [admin, category, instructor, terms, member] = await Promise.all([
    createAdmin(run),
    createCategory(run),
    createInstructor(run),
    createTermsTemplate(run),
    createMember(run),
  ])
  memberId = member.id
  const start = Date.now() + 10 * 86_400_000
  const [course] = await db
    .insert(courses)
    .values({
      slug: `receipt-${run}-${randomUUID().slice(0, 6)}`,
      status: "published",
      categoryId: category.id,
      instructorId: instructor.id,
      title: { en: "Candle making" },
      venue: { en: "Studio" },
      startsAt: new Date(start),
      endsAt: new Date(start + 7_200_000),
      minCapacity: 1,
      maxCapacity: 10,
      price: 150_000,
      registrationDeadline: new Date(start - 86_400_000),
      decisionAt: new Date(start - 2 * 86_400_000),
      termsTemplateId: terms.id,
      publishedAt: new Date(),
      createdBy: admin.id,
    })
    .returning()
  registrationId = (await addRegistration(course.id, member.id, terms.id, { status: "pending" })).id
  paidId = (await addRegistration(course.id, member.id, terms.id, { status: "confirmed" })).id
})
afterAll(() => rm(state.root, { recursive: true, force: true }))
beforeEach(async () => {
  state.cookies.clear()
  state.cookies.set(sessionCookieName("member"), (await createSession("member", memberId)).token)
})

const jpeg = async () =>
  new Blob([new Uint8Array(await sharp({ create: { width: 800, height: 1200, channels: 3, background: "#ddd" } }).jpeg().toBuffer())], {
    type: "image/jpeg",
  })

const send = async (id: string, file: Blob) => {
  const form = new FormData()
  form.append("registrationId", id)
  form.append("file", file, "receipt.jpg")
  return POST(new Request("http://localhost/api/account/receipts", { method: "POST", body: form, headers: { origin: ORIGIN } }))
}

describe("POST /api/account/receipts", () => {
  it("keeps the receipt with the member's registration that waits for payment", async () => {
    const res = await send(registrationId, await jpeg())
    expect([res.status, await res.json()]).toEqual([201, { ok: true }])
    const [row] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(row.receiptPath).toMatch(/^receipts\/[\w-]{22}\.webp$/)
    expect(row.receiptAt).toBeInstanceOf(Date)
    expect(telegram.notifyAdmins).toHaveBeenCalledWith(registrationId, "receipt")
  })

  it("refuses a paid registration, someone else's, and without a session", async () => {
    expect((await send(paidId, await jpeg())).status).toBe(404)
    expect((await send(randomUUID(), await jpeg())).status).toBe(404)
    state.cookies.clear()
    expect((await send(registrationId, await jpeg())).status).toBe(401)
  })

  it("refuses while a super admin views as the member", async () => {
    const admin = await createAdmin(run, "Mina")
    state.cookies.set(sessionCookieName("member"), (await createSession("member", memberId, new Date(), { impersonatedBy: admin.id })).token)
    expect((await send(registrationId, await jpeg())).status).toBe(403)
  })
})
