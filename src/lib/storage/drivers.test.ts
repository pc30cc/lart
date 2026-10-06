import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { encrypt } from "@/lib/crypto"
import { bunnyDriver } from "./bunny"
import { StorageError } from "./driver"
import { createStorage, testStorage, type CdnConfig } from "./index"
import { localDriver } from "./local"
import { r2Driver } from "./r2"

const bunny = {
  provider: "bunny",
  storageHost: "de.storage.bunnycdn.com",
  publicZone: "lart-public",
  publicZoneKeyEnc: encrypt("public-key-123"),
  publicHost: "cdn.example.com",
  privateZone: "lart-private",
  privateZoneKeyEnc: encrypt("private-key-456"),
} satisfies CdnConfig

const cloudflare = {
  provider: "cloudflare",
  accountId: "0123456789abcdef0123456789abcdef",
  accessKeyIdEnc: encrypt("AKIDEXAMPLE"),
  secretAccessKeyEnc: encrypt("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"),
  publicBucket: "lart-public",
  publicHost: "media.example.com",
  privateBucket: "lart-private",
} satisfies CdnConfig

type Handler = (req: Request) => Response | Promise<Response>
let requests: Request[]

function mockFetch(handler: Handler = () => new Response(null, { status: 201 })) {
  requests = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      requests.push(req.clone())
      return handler(req)
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe("bunny driver", () => {
  beforeEach(() => mockFetch())

  it("uploads to the zone with its AccessKey", async () => {
    await bunnyDriver(bunny).put("public", "gallery/2026-10/a.webp", Buffer.from("img"), "image/webp")
    const [req] = requests
    expect(req.method).toBe("PUT")
    expect(req.url).toBe("https://de.storage.bunnycdn.com/lart-public/gallery/2026-10/a.webp")
    expect(req.headers.get("AccessKey")).toBe("public-key-123")
    expect(req.redirect).toBe("error")
    expect(await req.text()).toBe("img")
  })

  it("keeps private files in the private zone with its own key", async () => {
    await bunnyDriver(bunny).put("private", "originals/2026-10/a.webp", new Blob(["x"]), "image/webp")
    expect(requests[0].url).toBe("https://de.storage.bunnycdn.com/lart-private/originals/2026-10/a.webp")
    expect(requests[0].headers.get("AccessKey")).toBe("private-key-456")
  })

  it("reads, deletes and builds public URLs", async () => {
    const driver = bunnyDriver(bunny)
    mockFetch((req) => (req.method === "GET" ? new Response("data", { headers: { "content-length": "4" } }) : new Response(null)))
    const file = await driver.get("private", "originals/2026-10/a.webp")
    expect(file?.size).toBe(4)
    expect(await new Response(file!.body).text()).toBe("data")
    await driver.remove("public", "gallery/2026-10/a.webp")
    expect(requests.map((r) => r.method)).toEqual(["GET", "DELETE"])
    expect(driver.publicUrl("gallery/2026-10/a.webp")).toBe("https://cdn.example.com/gallery/2026-10/a.webp")
  })

  it("treats a missing file as null / already deleted", async () => {
    mockFetch(() => new Response("Not found", { status: 404 }))
    const driver = bunnyDriver(bunny)
    expect(await driver.get("private", "a/b.webp")).toBeNull()
    await expect(driver.remove("public", "a/b.webp")).resolves.toBeUndefined()
  })

  it("fails without leaking the key", async () => {
    mockFetch(() => new Response("Unauthorized", { status: 401 }))
    const error = await bunnyDriver(bunny).put("public", "a/b.webp", Buffer.from("x"), "image/webp").catch((e) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(String(error.message)).not.toContain("public-key-123")
  })
})

describe("R2 driver", () => {
  beforeEach(() => mockFetch(() => new Response(null, { status: 200 })))

  it("signs an S3 PUT to the public bucket", async () => {
    await r2Driver(cloudflare).put("public", "gallery/2026-10/a.webp", Buffer.from("img"), "image/webp")
    const [req] = requests
    expect(req.method).toBe("PUT")
    expect(req.url).toBe("https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/lart-public/gallery/2026-10/a.webp")
    expect(req.headers.get("Authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
    )
    expect(req.headers.get("x-amz-content-sha256")).toBe("UNSIGNED-PAYLOAD")
    expect(req.headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/)
    expect(req.headers.get("Content-Type")).toBe("image/webp")
    expect(req.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")
    expect(req.redirect).toBe("error")
    expect(await req.text()).toBe("img")
  })

  it("streams Blob bodies and keeps private files uncached in the private bucket", async () => {
    await r2Driver(cloudflare).put("private", "originals/2026-10/a.webp", new Blob(["big"]), "image/webp")
    const [req] = requests
    expect(req.url).toContain("/lart-private/originals/2026-10/a.webp")
    expect(req.headers.get("Cache-Control")).toBeNull()
    expect(await req.text()).toBe("big")
  })

  it("signs GET and DELETE, and maps 404", async () => {
    const driver = r2Driver(cloudflare)
    mockFetch((req) => (req.method === "GET" ? new Response(null, { status: 404 }) : new Response(null, { status: 204 })))
    expect(await driver.get("private", "a/b.webp")).toBeNull()
    await driver.remove("public", "a/b.webp")
    expect(requests.map((r) => [r.method, r.headers.has("Authorization")])).toEqual([["GET", true], ["DELETE", true]])
    expect(driver.publicUrl("a/b.webp")).toBe("https://media.example.com/a/b.webp")
  })

  it("fails without leaking the secret", async () => {
    mockFetch(() => new Response("<Error>AccessDenied</Error>", { status: 403 }))
    const error = await r2Driver(cloudflare).put("public", "a/b.webp", Buffer.from("x"), "image/webp").catch((e) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(String(error.message)).not.toMatch(/wJalr|AKIDEXAMPLE/)
  })
})

describe("createStorage", () => {
  it("refuses unsafe paths before any request", async () => {
    mockFetch()
    const storage = createStorage(bunnyDriver(bunny))
    await expect(storage.putPublic("../../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toBeInstanceOf(StorageError)
    await expect(storage.readPrivate("a/../../b.webp")).rejects.toBeInstanceOf(StorageError)
    expect(() => storage.publicUrl("/x.webp")).toThrow(StorageError)
    expect(requests).toHaveLength(0)
  })
})

describe("local driver", () => {
  let root: string
  beforeEach(async () => (root = await mkdtemp(path.join(os.tmpdir(), "lart-storage-"))))
  afterEach(() => rm(root, { recursive: true, force: true }))

  it("writes, reads and removes files in their zone", async () => {
    const driver = localDriver(root)
    await driver.put("public", "gallery/2026-10/a.webp", Buffer.from("one"), "image/webp")
    await driver.put("private", "originals/2026-10/b.webp", new Blob(["two"]), "image/webp")
    expect(await readFile(path.join(root, "public/gallery/2026-10/a.webp"), "utf8")).toBe("one")
    const file = await driver.get("private", "originals/2026-10/b.webp")
    expect([file?.size, file?.contentType, await new Response(file!.body).text()]).toEqual([3, "image/webp", "two"])
    expect(await driver.get("public", "originals/2026-10/b.webp")).toBeNull()
    await driver.remove("private", "originals/2026-10/b.webp")
    expect(await driver.get("private", "originals/2026-10/b.webp")).toBeNull()
    expect(driver.publicUrl("gallery/2026-10/a.webp")).toBe("/media/gallery/2026-10/a.webp")
  })

  it.each(["../private/x.webp", "gallery/../../x.webp", "/etc/passwd", "gallery/x"])("refuses %s", (p) => {
    expect(() => localDriver(root).file("public", p)).toThrow(StorageError)
  })
})

describe("testStorage", () => {
  /** A fake Bunny: storage API per zone plus the public pull zone. */
  function fakeBunny({ failPut = false, publicHostWorks = true } = {}) {
    const files = new Map<string, string>()
    mockFetch(async (req) => {
      const url = new URL(req.url)
      if (url.host === "cdn.example.com") {
        const body = files.get(`lart-public${url.pathname}`)
        return publicHostWorks && body ? new Response(body) : new Response(null, { status: 404 })
      }
      const key = url.pathname.slice(1)
      if (req.method === "PUT") {
        if (failPut) return new Response(null, { status: 401 })
        files.set(key, await req.text())
        return new Response(null, { status: 201 })
      }
      if (req.method === "GET") return files.has(key) ? new Response(files.get(key)) : new Response(null, { status: 404 })
      files.delete(key)
      return new Response(null)
    })
    return files
  }

  it("passes when both zones and the public host work, and cleans up", async () => {
    const files = fakeBunny()
    expect(await testStorage(bunny)).toEqual({ ok: true })
    expect(files.size).toBe(0)
    expect(requests.map((r) => `${r.method} ${new URL(r.url).host}`)).toContain("GET cdn.example.com")
  })

  it("names the failing step and zone", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    fakeBunny({ failPut: true })
    expect(await testStorage(bunny)).toEqual({ ok: false, step: "write", zone: "public" })
    const files = fakeBunny({ publicHostWorks: false })
    expect(await testStorage(bunny)).toEqual({ ok: false, step: "url", zone: "public" })
    expect(files.size).toBe(0)
  })

  it("reports keys that cannot be decrypted", async () => {
    expect(await testStorage({ ...bunny, publicZoneKeyEnc: "v1.bad.bad.bad" })).toEqual({ ok: false, step: "config" })
  })
})
