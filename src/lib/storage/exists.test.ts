import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { exists, put, remove } from "./index"

// Local storage in a folder of its own.
const local = vi.hoisted(() => ({ root: "" }))
vi.mock("@/lib/settings", () => ({ getSetting: async () => ({ provider: "local" }) }))
vi.mock("./local", async (original) => {
  const actual = await original<typeof import("./local")>()
  return { ...actual, localDriver: () => actual.localDriver(local.root) }
})

beforeEach(async () => (local.root = await mkdtemp(path.join(os.tmpdir(), "lart-exists-"))))
afterEach(() => rm(local.root, { recursive: true, force: true }))

describe("exists", () => {
  it("tells whether a file is still in storage", async () => {
    const photo = "site/img-AbC_-123AbC_-123AbC_-1.webp"
    expect(await exists(photo)).toBe(false)
    await put(photo, Buffer.from("img"), "image/webp")
    expect(await exists(photo)).toBe(true)
    await remove(photo)
    expect(await exists(photo)).toBe(false)
  })

  it("counts a path storage refuses as missing", async () => {
    expect(await exists("site/../brand/x.webp")).toBe(false)
  })
})
