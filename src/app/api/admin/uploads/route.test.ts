import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ admin: true, root: "", audit: vi.fn(async (entry: unknown) => void entry) }))

vi.mock("@/lib/audit", () => ({ audit: state.audit }))

vi.mock("@/lib/auth/admin", () => ({
  requireAdminApi: async () => (state.admin ? { sessionId: "s", admin: { id: "a", email: "a@x", name: "A", shareBp: 0 } } : null),
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
afterAll(() => rm(state.root, { recursive: true, force: true }))
beforeEach(() => {
  state.admin = true
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
    expect(body.path).toMatch(/^instructors\/\d{4}-\d{2}\/[\w-]{22}\.webp$/)
    expect(body.path).not.toContain("IMG")
    expect(body.url).toBe(`/media/${body.path}`)
    expect(state.audit).toHaveBeenCalledWith({
      adminId: "a",
      action: "media.upload",
      entity: "media",
      entityId: body.path,
      data: { purpose: "instructor_photo", originalPath: undefined, width: 600, height: 600 },
    })
  })

  it("removes the stored file when the audit entry cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.audit.mockRejectedValueOnce(new Error("database down"))
    const res = await upload(await formWith("course_cover", await jpegBlob()))
    expect([res.status, await res.json()]).toEqual([500, { error: "server" }])
    const { readdir } = await import("node:fs/promises")
    const covers = await readdir(path.join(state.root, "public"), { recursive: true }).catch(() => [])
    expect(covers.filter((name) => String(name).startsWith("courses/") && String(name).endsWith(".webp"))).toEqual([])
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
      for (const [key, value] of Object.entries({ purpose: "gallery_video", total: String(video.length), ...fields })) form.append(key, value)
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
    expect(body.path).toMatch(/^gallery\/.+\.mp4$/)
    expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "media.upload", entityId: body.path }))
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
