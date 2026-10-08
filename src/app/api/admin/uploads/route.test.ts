import { randomUUID } from "node:crypto"
import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, categories, courses, instructors } from "@/db/schema"
import { createAdmin, createCategory, createInstructor, runId } from "@/features/workshops/test-fixtures"

const state = vi.hoisted(() => ({
  admin: true,
  name: "A",
  email: "a@x",
  root: "",
  audit: vi.fn(async (entry: unknown) => void entry),
}))

vi.mock("@/lib/audit", () => ({ audit: state.audit }))

vi.mock("@/lib/auth/admin", () => ({
  requireAdminApi: async () =>
    state.admin ? { sessionId: "s", admin: { id: "a", email: state.email, name: state.name, shareBp: 0 } } : null,
}))
vi.mock("@/lib/settings", async (original) => ({
  ...(await original<typeof import("@/lib/settings")>()),
  getSetting: async (key: "watermark") => (await original<typeof import("@/lib/settings")>()).settingDefaults[key],
}))
vi.mock("@/lib/storage", async (original) => {
  const actual = await original<typeof import("@/lib/storage")>()
  const { localDriver } = await import("@/lib/storage/local")
  return { ...actual, getStorage: async () => actual.createStorage(localDriver(state.root)) }
})

const { POST } = await import("./route")

state.root = await mkdtemp(path.join(os.tmpdir(), "lart-route-"))
/** A saved workshop and instructor, whose folders the server looks up. */
const saved = { courseId: "", slug: `mum-yapimi-${runId()}`, instructorId: "", categoryId: "", adminId: "" }
beforeAll(async () => {
  const run = runId()
  const [admin, category, instructor] = await Promise.all([createAdmin(run), createCategory(run), createInstructor(run)])
  const start = new Date(Date.now() + 7 * 86_400_000)
  const [course] = await db
    .insert(courses)
    .values({
      slug: saved.slug,
      categoryId: category.id,
      instructorId: instructor.id,
      title: { tr: "Mum Yapımı" },
      venue: { tr: "Studio" },
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * 3_600_000),
      minCapacity: 3,
      maxCapacity: 10,
      price: 150000,
      registrationDeadline: start,
      decisionAt: start,
      createdBy: admin.id,
    })
    .returning({ id: courses.id })
  Object.assign(saved, { courseId: course.id, instructorId: instructor.id, categoryId: category.id, adminId: admin.id })
})
afterAll(async () => {
  await rm(state.root, { recursive: true, force: true })
  await db.delete(courses).where(eq(courses.id, saved.courseId))
  await db.delete(categories).where(eq(categories.id, saved.categoryId))
  await db.delete(instructors).where(eq(instructors.id, saved.instructorId))
  await db.delete(admins).where(eq(admins.id, saved.adminId))
})
beforeEach(() => {
  Object.assign(state, { admin: true, name: "A", email: "a@x" })
})

const upload = (form: FormData, headers?: Record<string, string>) =>
  POST(new Request("http://localhost/api/admin/uploads", { method: "POST", body: form, headers }))

const formWith = async (purpose: string, file: Blob | null, order: "purpose-first" | "file-first" = "purpose-first") => {
  const form = new FormData()
  if (order === "file-first" && file) form.append("file", file, "x.jpg")
  form.append("purpose", purpose)
  if (order === "purpose-first" && file) form.append("file", file, "IMG_0001 (copy).jpg")
  return form
}

/** Text fields first (in this order), then the file. */
const formOf = (fields: Record<string, string>, file: Blob) => {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  form.append("file", file, "photo.jpg")
  return form
}
/** Paths of every stored file. */
const storedFiles = async () => (await readdir(state.root, { recursive: true }).catch(() => [])).map(String)

const jpegBlob = async () =>
  new Blob([new Uint8Array(await sharp({ create: { width: 900, height: 600, channels: 3, background: "#888" } }).jpeg().toBuffer())], {
    type: "image/jpeg",
  })

describe("POST /api/admin/uploads", () => {
  it("answers 401 without an admin session", async () => {
    state.admin = false
    const res = await upload(await formWith("course_cover", await jpegBlob()))
    expect([res.status, await res.json()]).toEqual([401, { error: "unauthorized" }])
  })

  it("processes and stores an image sent by a real multipart encoder", async () => {
    const res = await upload(await formWith("instructor_photo", await jpegBlob()))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ width: 600, height: 600 })
    expect(body.path).toMatch(/^instructors\/new\/photo-[\w-]{22}\.webp$/)
    expect(body.path).not.toContain("IMG")
    expect(body.url).toBe(`/media/${body.path}`)
    expect(state.audit).toHaveBeenCalledWith({
      adminId: "a",
      action: "media.upload",
      entity: "media",
      entityId: body.path,
      data: { purpose: "instructor_photo", width: 600, height: 600 },
    })
  })

  it("removes the stored file when the audit entry cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.audit.mockRejectedValueOnce(new Error("database down"))
    const res = await upload(await formWith("course_cover", await jpegBlob()))
    expect([res.status, await res.json()]).toEqual([500, { error: "server" }])
    expect((await storedFiles()).filter((name) => name.includes("cover-"))).toEqual([])
  })

  it("stores a partner's photo like any other file, in a folder named after them, with its CDN URL", async () => {
    state.name = "Mina Karimi"
    const res = await upload(await formWith("admin_photo", await jpegBlob()))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ width: 512, height: 512 })
    expect(body.path).toMatch(/^partners\/mina-karimi\/photo-[\w-]{22}\.webp$/)
    expect(body.url).toBe(`/media/${body.path}`)
    expect((await stat(path.join(state.root, body.path))).isFile()).toBe(true)
    expect(state.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({ adminId: "a", entityId: body.path, data: expect.objectContaining({ purpose: "admin_photo" }) }),
    )
  })

  it.each(["مینا کریمی", "مینا 2"])("names a partner's folder after their email when their name %j has no Latin letters", async (name) => {
    Object.assign(state, { name, email: "mina.k@example.com" })
    const body = await (await upload(await formWith("admin_photo", await jpegBlob()))).json()
    expect(body.path).toMatch(/^partners\/mina-k\/photo-[\w-]{22}\.webp$/)
  })

  it("never names a partner's public portrait after their email (the About page shows its address)", async () => {
    Object.assign(state, { name: "مینا کریمی", email: "mina.k@example.com" })
    const persian = await (await upload(await formWith("partner_portrait", await jpegBlob()))).json()
    expect(persian.path).toMatch(/^partners\/partner\/portrait-[\w-]{22}\.webp$/)
    Object.assign(state, { name: "Mina Karimi", email: "mina.k@example.com" })
    const latin = await (await upload(await formWith("partner_portrait", await jpegBlob()))).json()
    expect(latin.path).toMatch(/^partners\/mina-karimi\/portrait-[\w-]{22}\.webp$/)
  })

  it("removes a partner's photo when the audit entry cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const photos = async () => (await storedFiles()).filter((name) => name.startsWith("partners/") && name.endsWith(".webp")).sort()
    const before = await photos()
    state.audit.mockRejectedValueOnce(new Error("database down"))
    const res = await upload(await formWith("admin_photo", await jpegBlob()))
    expect([res.status, await res.json()]).toEqual([500, { error: "server" }])
    expect(await photos()).toEqual(before)
  })

  it("names a saved workshop's files after its slug from the database, whatever the form says", async () => {
    const res = await upload(formOf({ purpose: "course_cover", courseId: saved.courseId, folder: "../../brand" }, await jpegBlob()))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.path).toMatch(new RegExp(`^workshops/${saved.slug}/cover-[\\w-]{22}\\.webp$`))
    expect((await stat(path.join(state.root, body.path))).isFile()).toBe(true)
  })

  it.each([
    ["Mum Yapımı Atölyesi", "workshops/mum-yapimi-atolyesi/samples/"],
    ["../../etc/passwd", "workshops/etc-passwd/samples/"],
    ["شمع‌سازی", "workshops/new/samples/"],
    ["", "workshops/new/samples/"],
  ])("puts a new workshop's files in a folder named after the form's hint %j, sanitized", async (folder, prefix) => {
    const res = await upload(formOf({ purpose: "course_sample", ...(folder && { folder }) }, await jpegBlob()))
    expect(res.status).toBe(201)
    const { path: stored } = await res.json()
    expect(stored.startsWith(prefix)).toBe(true)
    expect(stored.slice(prefix.length)).toMatch(/^[\w-]{22}\.webp$/)
  })

  it("names an instructor's photo after the saved instructor's English name, or a new one's hint", async () => {
    const existing = await (await upload(formOf({ purpose: "instructor_photo", instructorId: saved.instructorId }, await jpegBlob()))).json()
    expect(existing.path).toMatch(/^instructors\/zeynep\/photo-[\w-]{22}\.webp$/)
    const fresh = await (await upload(formOf({ purpose: "instructor_photo", folder: "Çiğdem Işık" }, await jpegBlob()))).json()
    expect(fresh.path).toMatch(/^instructors\/cigdem-isik\/photo-[\w-]{22}\.webp$/)
  })

  it.each([
    ["an unknown workshop", { purpose: "course_cover", courseId: randomUUID() }],
    ["an unknown instructor", { purpose: "instructor_photo", instructorId: randomUUID() }],
    ["a workshop id that is not a uuid", { purpose: "gallery_photo", courseId: "../x" }],
    ["an instructor for a workshop file", { purpose: "course_cover", instructorId: randomUUID() }],
    ["a workshop for an instructor photo", { purpose: "instructor_photo", courseId: randomUUID() }],
    ["a folder for a partner's photo", { purpose: "admin_photo", folder: "someone-else" }],
    ["a workshop for the watermark logo", { purpose: "watermark_logo", courseId: randomUUID() }],
    ["a folder hint over 64 bytes", { purpose: "course_cover", folder: "a".repeat(65) }],
    ["a workshop for a home page photo", { purpose: "site_image", courseId: randomUUID() }],
    ["an instructor for a home page photo", { purpose: "site_image", instructorId: randomUUID() }],
    ["a folder for a home page photo", { purpose: "site_image", folder: "workshops" }],
    ["a workshop for the home page video", { purpose: "site_video", courseId: randomUUID() }],
    ["a folder for the home page video", { purpose: "site_video", folder: "" }],
  ])("answers 400 for %s, storing nothing", async (_, fields) => {
    const before = await storedFiles()
    const res = await upload(formOf(fields, await jpegBlob()))
    expect([res.status, await res.json()]).toEqual([400, { error: "bad_request" }])
    expect(await storedFiles()).toEqual(before)
  })

  it.each([
    ["an unknown purpose", () => formWith("avatar", null)],
    ["no file", () => formWith("course_cover", null)],
    ["the file before the purpose", async () => formWith("course_cover", await jpegBlob(), "file-first")],
  ])("answers 400 for %s", async (_, make) => {
    const res = await upload(await make())
    expect([res.status, await res.json()]).toEqual([400, { error: "bad_request" }])
  })

  it("answers 400 for a body that is not multipart", async () => {
    const res = await POST(new Request("http://localhost/api/admin/uploads", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))
    expect(res.status).toBe(400)
  })

  it("answers 415 for a file that is not an image", async () => {
    const res = await upload(await formWith("course_cover", new Blob(["<svg onload=alert(1)>"], { type: "image/jpeg" })))
    expect([res.status, await res.json()]).toEqual([415, { error: "unsupported_type" }])
  })

  it("takes a video in parts and stores it when the last part arrives", async () => {
    const video = new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom\0\0\0\0isommp41"), Buffer.alloc(50_000, 3)]))
    const send = (fields: Record<string, string>, from: number, to: number, extra = 0) => {
      const form = new FormData()
      const all = { purpose: "gallery_video", courseId: saved.courseId, total: String(video.length), ...fields }
      for (const [key, value] of Object.entries(all)) form.append(key, value)
      form.append("file", new Blob([video.subarray(from, to), new Uint8Array(extra)]), "clip.mp4")
      return upload(form)
    }
    const first = await send({}, 0, 30_000)
    expect(first.status).toBe(202)
    const { upload: id, received } = await first.json()
    expect(received).toBe(30_000)

    const behind = await send({ upload: id, offset: "10000" }, 10_000, 30_000)
    expect([behind.status, await behind.json()]).toEqual([409, { upload: id, received: 30_000 }])

    const tooLong = await send({ upload: id, offset: "30000" }, 30_000, video.length, 1)
    expect([tooLong.status, await tooLong.json()]).toEqual([413, { error: "too_large" }])

    const last = await send({ upload: id, offset: "30000" }, 30_000, video.length)
    expect(last.status).toBe(201)
    const body = await last.json()
    expect(body.path).toMatch(new RegExp(`^workshops/${saved.slug}/videos/[\\w-]{22}\\.mp4$`))
    expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "media.upload", entityId: body.path }))
  })

  it("stores a home page photo in site/, never watermarked, also while no watermark logo is set", async () => {
    const res = await upload(await formWith("site_image", await jpegBlob()))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ width: 900, height: 600, url: `/media/${body.path}` })
    expect(body.path).toMatch(/^site\/img-[\w-]{22}\.webp$/)
    expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({ entityId: body.path, data: expect.objectContaining({ purpose: "site_image" }) }))
    // The same photo for a gallery waits for the logo.
    const gallery = await upload(await formWith("gallery_photo", await jpegBlob()))
    expect([gallery.status, await gallery.json()]).toEqual([409, { error: "watermark_missing" }])
  })

  describe("the home page's video", () => {
    const mp4 = new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom\0\0\0\0isommp41"), Buffer.alloc(20_000, 3)]))
    const mov = new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  \0\0\0\0qt  "), Buffer.alloc(20_000, 3)]))
    const send = (bytes: Uint8Array<ArrayBuffer>, total = bytes.length) => {
      const form = new FormData()
      form.append("purpose", "site_video")
      form.append("total", String(total))
      form.append("file", new Blob([bytes]), "clip.mp4")
      return upload(form)
    }
    const siteFiles = async () => (await storedFiles()).filter((name) => name.startsWith("site/video-"))

    it("stores an MP4 in site/", async () => {
      const res = await send(mp4)
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.path).toMatch(/^site\/video-[\w-]{22}\.mp4$/)
      expect((await stat(path.join(state.root, body.path))).size).toBe(mp4.length)
      expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({ entityId: body.path, data: expect.objectContaining({ purpose: "site_video" }) }))
    })

    it("refuses a MOV (it does not play by itself in every browser), storing nothing", async () => {
      const before = await siteFiles()
      const res = await send(mov)
      expect([res.status, await res.json()]).toEqual([415, { error: "unsupported_type" }])
      expect(await siteFiles()).toEqual(before)
    })

    it("refuses one over 80 MB", async () => {
      const res = await send(mp4, 80 * 1024 * 1024 + 1)
      expect([res.status, await res.json()]).toEqual([413, { error: "too_large" }])
    })
  })

  it("refuses video part fields on images", async () => {
    const form = await formWith("course_cover", null)
    form.append("total", "10")
    form.append("file", await jpegBlob(), "a.jpg")
    expect((await upload(form)).status).toBe(400)
  })

  it("answers 413 for files over the purpose limit", async () => {
    const big = new Blob([new Uint8Array(15 * 1024 * 1024 + 1)], { type: "image/jpeg" })
    const res = await upload(await formWith("course_cover", big))
    expect([res.status, await res.json()]).toEqual([413, { error: "too_large" }])
  })
})
