import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  read: vi.fn(async (path: string) => ({
    body: new Blob([`logo of ${path}`]).stream(),
    size: null,
    contentType: "image/png",
  })),
  render: vi.fn(async (settings: unknown, logo?: Buffer | null) => Buffer.from(logo ? "with logo" : "without logo")),
}))

vi.mock("@/lib/auth/admin", () => ({
  requireAdminApi: async () => ({ sessionId: "s", admin: { id: "a", email: "a@x", name: "A", shareBp: 0 } }),
}))
vi.mock("@/lib/settings", async (original) => ({
  ...(await original<typeof import("@/lib/settings")>()),
  getSetting: async (key: "watermark") => (await original<typeof import("@/lib/settings")>()).settingDefaults[key],
}))
vi.mock("@/lib/storage", () => ({ read: state.read }))
vi.mock("@/lib/images", () => ({ renderWatermarkPreview: state.render }))

const { GET } = await import("./route")

const preview = (query: string) => GET(new NextRequest(`http://localhost/api/admin/media/watermark-preview?${query}`))

beforeEach(() => {
  state.read.mockClear()
  state.render.mockClear()
})

describe("GET /api/admin/media/watermark-preview", () => {
  it("previews a logo just uploaded, before it is saved", async () => {
    const res = await preview("logo=brand/watermark-logo-abcdefghijklmnopqrstuv.png&position=tiled")
    expect(res.status).toBe(200)
    expect(state.read).toHaveBeenCalledWith("brand/watermark-logo-abcdefghijklmnopqrstuv.png")
    expect(state.render).toHaveBeenCalledWith(expect.objectContaining({ position: "tiled" }), expect.any(Buffer))
  })

  // read() loads the whole file: the preview must not reach a gallery video or photo in the same storage.
  it.each([
    "workshops/mum-yapimi/videos/abcdefghijklmnopqrstuv.mp4",
    "workshops/mum-yapimi/gallery/abcdefghijklmnopqrstuv.webp",
    "partners/mina-k/photo-abcdefghijklmnopqrstuv.webp",
    "brand/../workshops/x.png",
  ])("refuses a logo path that is not a logo: %s", async (logo) => {
    const res = await preview(`logo=${encodeURIComponent(logo)}`)
    expect(res.status).toBe(400)
    expect(state.read).not.toHaveBeenCalled()
  })
})
