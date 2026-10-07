import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { and, eq } from "drizzle-orm"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { auditLog, instructors } from "@/db/schema"
import { createAdmin, createInstructor, runId } from "@/features/workshops/test-fixtures"
import { sessionCookieName } from "@/lib/auth/cookies"
import { createSession } from "@/lib/auth/session"
import { env } from "@/lib/env"

/** One request's cookies (the real instructor session is looked up in the database). */
const state = vi.hoisted(() => ({ cookies: new Map<string, string>(), root: "" }))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "198.51.100.4" }),
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
let instructorId: string

beforeAll(async () => {
  state.root = await mkdtemp(path.join(os.tmpdir(), "lart-instructor-upload-"))
  instructorId = (await createInstructor(run)).id
})
afterAll(() => rm(state.root, { recursive: true, force: true }))
beforeEach(async () => {
  state.cookies.clear()
  const { token } = await createSession("instructor", instructorId)
  state.cookies.set(sessionCookieName("instructor"), token)
})

const jpeg = async () =>
  new Blob([new Uint8Array(await sharp({ create: { width: 900, height: 600, channels: 3, background: "#a86" } }).jpeg().toBuffer())], {
    type: "image/jpeg",
  })

const formWith = (purpose: string, file: Blob) => {
  const form = new FormData()
  form.append("purpose", purpose)
  form.append("file", file, "me.jpg")
  return form
}

const upload = (form: FormData, headers: Record<string, string> = { origin: ORIGIN }) =>
  POST(new Request("http://localhost/api/instructor/uploads", { method: "POST", body: form, headers }))

describe("POST /api/instructor/uploads", () => {
  it("stores the profile photo square, and records who uploaded it", async () => {
    const res = await upload(formWith("instructor_photo", await jpeg()))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ width: 600, height: 600 })
    expect(body.path).toMatch(/^instructors\/zeynep\/photo-[\w-]{22}\.webp$/)

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "media.upload"), eq(auditLog.entityId, body.path)))
    expect(entry).toMatchObject({ adminId: null, entity: "media", data: { purpose: "instructor_photo", by: "instructor", instructorId } })
  })

  it("records the super admin viewing as the instructor as the uploader's admin", async () => {
    const admin = await createAdmin(run, "Mina")
    const { token } = await createSession("instructor", instructorId, new Date(), { impersonatedBy: admin.id })
    state.cookies.set(sessionCookieName("instructor"), token)
    const res = await upload(formWith("instructor_photo", await jpeg()))
    expect(res.status).toBe(201)
    const { path: stored } = await res.json()
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "media.upload"), eq(auditLog.entityId, stored)))
    expect(entry).toMatchObject({
      adminId: admin.id,
      data: { purpose: "instructor_photo", by: "instructor", instructorId, impersonatedBy: admin.id },
    })
  })

  it("names the folder after the instructor's English name, else the Turkish one, else 'unnamed'", async () => {
    const other = await createInstructor(run)
    state.cookies.set(sessionCookieName("instructor"), (await createSession("instructor", other.id)).token)
    const folderOf = async (displayName: { fa?: string; tr?: string; en?: string }) => {
      await db.update(instructors).set({ displayName }).where(eq(instructors.id, other.id))
      const { path } = await (await upload(formWith("instructor_photo", await jpeg()))).json()
      return path.split("/").slice(0, 2).join("/")
    }
    expect(await folderOf({ fa: "چیگدم", tr: "Çiğdem Işık", en: "" })).toBe("instructors/cigdem-isik")
    expect(await folderOf({ fa: "چیگدم", tr: "Çiğdem", en: "Chigdem Ishik" })).toBe("instructors/chigdem-ishik")
    expect(await folderOf({ fa: "چیگدم" })).toBe("instructors/unnamed")
  })

  it("answers 401 without an instructor session", async () => {
    state.cookies.clear()
    const res = await upload(formWith("instructor_photo", await jpeg()))
    expect([res.status, await res.json()]).toEqual([401, { error: "unauthorized" }])
  })

  it("answers 401 to a request from another site, even with a session (CSRF)", async () => {
    const res = await upload(formWith("instructor_photo", await jpeg()), { origin: "https://evil.example" })
    expect(res.status).toBe(401)
    expect((await upload(formWith("instructor_photo", await jpeg()), {})).status).toBe(401)
  })

  it("answers 401 once the instructor is deactivated", async () => {
    const other = await createInstructor(run)
    const { token } = await createSession("instructor", other.id)
    state.cookies.set(sessionCookieName("instructor"), token)
    await db.update(instructors).set({ active: false }).where(eq(instructors.id, other.id))
    expect((await upload(formWith("instructor_photo", await jpeg()))).status).toBe(401)
  })

  it.each(["course_cover", "gallery_photo", "watermark_logo", "admin_photo", "gallery_video"])("refuses the admins' purpose %s", async (purpose) => {
    const res = await upload(formWith(purpose, await jpeg()))
    expect([res.status, await res.json()]).toEqual([400, { error: "bad_request" }])
  })

  it("refuses a file that is not an image, and one over the size limit", async () => {
    const svg = await upload(formWith("instructor_photo", new Blob(["<svg onload=alert(1)>"], { type: "image/jpeg" })))
    expect([svg.status, await svg.json()]).toEqual([415, { error: "unsupported_type" }])
    const big = await upload(formWith("instructor_photo", new Blob([new Uint8Array(15 * 1024 * 1024 + 1)], { type: "image/jpeg" })))
    expect([big.status, await big.json()]).toEqual([413, { error: "too_large" }])
  })

  it("answers 429 after 20 uploads in an hour from one instructor", async () => {
    const busy = await createInstructor(run)
    state.cookies.set(sessionCookieName("instructor"), (await createSession("instructor", busy.id)).token)
    const tiny = new Blob(["x"], { type: "image/jpeg" })
    for (let i = 0; i < 20; i++) expect((await upload(formWith("instructor_photo", tiny))).status).toBe(415)
    const res = await upload(formWith("instructor_photo", await jpeg()))
    expect([res.status, await res.json()]).toEqual([429, { error: "rate_limited" }])
  })
})
