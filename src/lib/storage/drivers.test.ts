import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { encrypt } from "@/lib/crypto"
import { settingSchemas } from "@/lib/settings"
import { bunnyDriver } from "./bunny"
import { StorageError } from "./driver"
import { createDriver, createStorage, testStorage, type CdnConfig } from "./index"
import { localDriver } from "./local"
import { r2Driver } from "./r2"

const bunny = {
  provider: "bunny",
  storageHost: "de.storage.bunnycdn.com",
  publicZone: "lart-public",
  publicZoneKeyEnc: encrypt("public-key-123"),
  publicHost: "cdn.example.com",
} satisfies CdnConfig

const cloudflare = {
  provider: "cloudflare",
  accountId: "0123456789abcdef0123456789abcdef",
  accessKeyIdEnc: encrypt("AKIDEXAMPLE"),
  secretAccessKeyEnc: encrypt("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"),
  publicBucket: "lart-public",
  publicHost: "media.example.com",
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
    await bunnyDriver(bunny).put("workshops/mum/gallery/a.webp", Buffer.from("img"), "image/webp")
    const [req] = requests
    expect(req.method).toBe("PUT")
    expect(req.url).toBe("https://de.storage.bunnycdn.com/lart-public/workshops/mum/gallery/a.webp")
    expect(req.headers.get("AccessKey")).toBe("public-key-123")
    expect(req.redirect).toBe("error")
    expect(await req.text()).toBe("img")
  })

  it("reads through the storage API with the key (not the CDN), deletes and builds public URLs", async () => {
    const driver = bunnyDriver(bunny)
    mockFetch((req) => (req.method === "GET" ? new Response("data", { headers: { "content-length": "4" } }) : new Response(null)))
    const file = await driver.get("brand/watermark-logo-a.png")
    expect(file?.size).toBe(4)
    expect(await new Response(file!.body).text()).toBe("data")
    await driver.remove("workshops/mum/gallery/a.webp")
    expect(requests.map((r) => [r.method, r.url, r.headers.get("AccessKey")])).toEqual([
      ["GET", "https://de.storage.bunnycdn.com/lart-public/brand/watermark-logo-a.png", "public-key-123"],
      ["DELETE", "https://de.storage.bunnycdn.com/lart-public/workshops/mum/gallery/a.webp", "public-key-123"],
    ])
    expect(driver.publicUrl("workshops/mum/gallery/a.webp")).toBe("https://cdn.example.com/workshops/mum/gallery/a.webp")
  })

  it("treats a missing file as null / already deleted", async () => {
    mockFetch(() => new Response("Not found", { status: 404 }))
    const driver = bunnyDriver(bunny)
    expect(await driver.get("a/b.webp")).toBeNull()
    await expect(driver.remove("a/b.webp")).resolves.toBeUndefined()
  })

  it("works with a setting saved when there was a private zone too, using only the zone", async () => {
    const saved = { ...bunny, privateZone: "lart-private", privateZoneKeyEnc: encrypt("private-key-456") }
    const config = settingSchemas.cdn.parse(saved)
    expect(config).toEqual(bunny)
    await createDriver(config).put("brand/watermark-logo-a.png", Buffer.from("png"), "image/png")
    expect([requests[0].url, requests[0].headers.get("AccessKey")]).toEqual([
      "https://de.storage.bunnycdn.com/lart-public/brand/watermark-logo-a.png",
      "public-key-123",
    ])
  })

  it("fails without leaking the key", async () => {
    mockFetch(() => new Response("Unauthorized", { status: 401 }))
    const error = await bunnyDriver(bunny).put("a/b.webp", Buffer.from("x"), "image/webp").catch((e) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(String(error.message)).not.toContain("public-key-123")
  })
})

describe("R2 driver", () => {
  beforeEach(() => mockFetch(() => new Response(null, { status: 200 })))

  it("signs an S3 PUT to the bucket, cached for good", async () => {
    await r2Driver(cloudflare).put("workshops/mum/gallery/a.webp", Buffer.from("img"), "image/webp")
    const [req] = requests
    expect(req.method).toBe("PUT")
    expect(req.url).toBe("https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/lart-public/workshops/mum/gallery/a.webp")
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

  it("streams Blob bodies", async () => {
    await r2Driver(cloudflare).put("workshops/mum/videos/a.mp4", new Blob(["big"]), "video/mp4")
    const [req] = requests
    expect(req.url).toContain("/lart-public/workshops/mum/videos/a.mp4")
    expect(req.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")
    expect(await req.text()).toBe("big")
  })

  it("reads with a signed GetObject, signs DELETE, and maps 404", async () => {
    const driver = r2Driver(cloudflare)
    mockFetch((req) => (req.method === "GET" ? new Response(null, { status: 404 }) : new Response(null, { status: 204 })))
    expect(await driver.get("a/b.webp")).toBeNull()
    await driver.remove("a/b.webp")
    expect(requests.map((r) => [r.method, new URL(r.url).pathname, r.headers.has("Authorization")])).toEqual([
      ["GET", "/lart-public/a/b.webp", true],
      ["DELETE", "/lart-public/a/b.webp", true],
    ])
    expect(driver.publicUrl("a/b.webp")).toBe("https://media.example.com/a/b.webp")

    mockFetch(() => new Response("data"))
    expect(await new Response((await driver.get("a/b.webp"))!.body).text()).toBe("data")
  })

  it("works with a setting saved when there was a private bucket too", async () => {
    const config = settingSchemas.cdn.parse({ ...cloudflare, privateBucket: "lart-private" })
    expect(config).toEqual(cloudflare)
    await createDriver(config).put("a/b.webp", Buffer.from("x"), "image/webp")
    expect(requests[0].url).toContain("/lart-public/a/b.webp")
  })

  it("fails without leaking the secret", async () => {
    mockFetch(() => new Response("<Error>AccessDenied</Error>", { status: 403 }))
    const error = await r2Driver(cloudflare).put("a/b.webp", Buffer.from("x"), "image/webp").catch((e) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(String(error.message)).not.toMatch(/wJalr|AKIDEXAMPLE/)
  })
})

describe("createStorage", () => {
  it("refuses unsafe paths before any request", async () => {
    mockFetch()
    const storage = createStorage(bunnyDriver(bunny))
    await expect(storage.put("../../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toBeInstanceOf(StorageError)
    await expect(storage.read("a/../../b.webp")).rejects.toBeInstanceOf(StorageError)
    await expect(storage.remove("workshops/../../b.webp")).rejects.toBeInstanceOf(StorageError)
    expect(() => storage.publicUrl("/x.webp")).toThrow(StorageError)
    expect(requests).toHaveLength(0)
  })
})

describe("local driver", () => {
  let root: string
  beforeEach(async () => (root = await mkdtemp(path.join(os.tmpdir(), "lart-storage-"))))
  afterEach(() => rm(root, { recursive: true, force: true }))

  it("writes, reads and removes files in its folder", async () => {
    const driver = localDriver(root)
    await driver.put("workshops/mum/gallery/a.webp", Buffer.from("one"), "image/webp")
    await driver.put("brand/watermark-logo-b.png", new Blob(["two"]), "image/png")
    expect(await readFile(path.join(root, "workshops/mum/gallery/a.webp"), "utf8")).toBe("one")
    const file = await driver.get("brand/watermark-logo-b.png")
    expect([file?.size, file?.contentType, await new Response(file!.body).text()]).toEqual([3, "image/png", "two"])
    await driver.remove("brand/watermark-logo-b.png")
    expect(await driver.get("brand/watermark-logo-b.png")).toBeNull()
    expect(driver.publicUrl("workshops/mum/gallery/a.webp")).toBe("/media/workshops/mum/gallery/a.webp")
  })

  it.each(["../private/x.webp", "gallery/../../x.webp", "/etc/passwd", "gallery/x"])("refuses %s", (p) => {
    expect(() => localDriver(root).file(p)).toThrow(StorageError)
  })
})

describe("testStorage", () => {
  /** A fake Bunny: the storage API plus the pull zone. */
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

  it("passes when the zone and the CDN hostname work, and cleans up", async () => {
    const files = fakeBunny()
    expect(await testStorage(bunny)).toEqual({ ok: true })
    expect(files.size).toBe(0)
    expect(requests.map((r) => `${r.method} ${new URL(r.url).host}`)).toContain("GET cdn.example.com")
  })

  it("names the failing step", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    fakeBunny({ failPut: true })
    expect(await testStorage(bunny)).toEqual({ ok: false, step: "write" })
    const files = fakeBunny({ publicHostWorks: false })
    expect(await testStorage(bunny)).toEqual({ ok: false, step: "url" })
    expect(files.size).toBe(0)
  })

  it("probes one zone only, with one file", async () => {
    fakeBunny()
    await testStorage(bunny)
    expect(requests.map((r) => `${r.method} ${new URL(r.url).host}${new URL(r.url).pathname.replace(/[^/]+$/, "…")}`)).toEqual([
      "PUT de.storage.bunnycdn.com/lart-public/_probe/…",
      "GET de.storage.bunnycdn.com/lart-public/_probe/…",
      "GET cdn.example.com/_probe/…",
      "DELETE de.storage.bunnycdn.com/lart-public/_probe/…",
    ])
  })

  it("reports keys that cannot be decrypted", async () => {
    expect(await testStorage({ ...bunny, publicZoneKeyEnc: "v1.bad.bad.bad" })).toEqual({ ok: false, step: "config" })
  })
})
