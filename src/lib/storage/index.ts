import "server-only"
import { randomBytes } from "node:crypto"

import { errorForLog } from "@/lib/errors"
import { getSetting, type SettingValue } from "@/lib/settings"
import { bunnyDriver } from "./bunny"
import { StorageError, type Body, type Driver, type StoredFile } from "./driver"
import { localDriver } from "./local"
import { r2Driver } from "./r2"
import { isSafePath } from "./shared"

/**
 * Media storage on the CDN chosen in the "cdn" setting (local in development,
 * Bunny Storage or Cloudflare R2): one storage space, every file served by the
 * CDN under an unguessable path. The database stores only the path.
 */

export type { Body, StoredFile }
export { StorageError }
export * from "./shared"

export type CdnConfig = SettingValue<"cdn">

export type Storage = {
  put(path: string, body: Body, contentType: string): Promise<void>
  /** A file read through the storage API with the key (e.g. the watermark logo), or null when missing. */
  read(path: string): Promise<StoredFile | null>
  /** Delete a file; a missing file is not an error. */
  remove(path: string): Promise<void>
  /** Public URL (CDN) of a file. */
  publicUrl(path: string): string
}

/** Keys are decrypted here; throws if they cannot be. */
export function createDriver(config: CdnConfig): Driver {
  switch (config.provider) {
    case "local":
      return localDriver()
    case "bunny":
      return bunnyDriver(config)
    case "cloudflare":
      return r2Driver(config)
  }
}

export function createStorage(driver: Driver): Storage {
  const safe = (path: string) => {
    if (!isSafePath(path)) throw new StorageError("Unsafe storage path")
    return path
  }
  return {
    put: async (path, body, type) => driver.put(safe(path), body, type),
    read: async (path) => driver.get(safe(path)),
    remove: async (path) => driver.remove(safe(path)),
    publicUrl: (path) => driver.publicUrl(safe(path)),
  }
}

/** Storage for the current "cdn" setting. Use `publicUrl` of the result for lists. */
export async function getStorage(): Promise<Storage> {
  return createStorage(createDriver(await getSetting("cdn")))
}

export const put = async (path: string, body: Body, contentType: string) => (await getStorage()).put(path, body, contentType)
export const read = async (path: string) => (await getStorage()).read(path)
export const remove = async (path: string) => (await getStorage()).remove(path)
export const publicUrl = async (path: string) => (await getStorage()).publicUrl(path)

/**
 * For pages: `url(path)` gives a file's public URL, or null without a path
 * or when the "cdn" setting cannot be used (logged once), so the page shows
 * no image (initials, a placeholder) instead of failing.
 */
export async function publicUrls(): Promise<(path: string | null | undefined) => string | null> {
  const storage = await getStorage().catch((err) => {
    console.error("[storage] unavailable", errorForLog(err))
    return null
  })
  return (path) => {
    if (!storage || !path) return null
    try {
      return storage.publicUrl(path)
    } catch {
      return null
    }
  }
}

/**
 * A new random, unguessable path: `<dir>/<name><128 random bits>.<ext>`, e.g.
 * `workshops/<slug>/cover-<random>.webp` (see `uploadPath`). The original file
 * name never appears in it.
 */
export function newObjectPath(dir: string, ext: string, name = ""): string {
  const path = `${dir}/${name}${randomBytes(16).toString("base64url")}.${ext}`
  if (!isSafePath(path)) throw new Error(`Invalid storage folder, name or extension: ${dir} ${name} ${ext}`)
  return path
}

export type StorageTestStep = "config" | "write" | "read" | "url" | "delete"
export type StorageTestResult = { ok: true } | { ok: false; step: StorageTestStep }

/**
 * "Test connection" for the settings page: write a tiny probe file, read it
 * back (and through the public URL, except for local storage), then delete
 * it. Takes the settings shape, keys encrypted. Messages for each failed step
 * are in the "settings" namespace under `storage.test`.
 */
export async function testStorage(config: CdnConfig): Promise<StorageTestResult> {
  let driver: Driver
  try {
    driver = createDriver(config)
  } catch {
    return { ok: false, step: "config" }
  }
  const path = newObjectPath("_probe", "txt")
  const probe = Buffer.from(randomBytes(16).toString("hex"))
  const step = await runProbe(driver, path, probe, config.provider !== "local")
  return step ? { ok: false, step } : { ok: true }
}

async function runProbe(driver: Driver, path: string, probe: Buffer, checkUrl: boolean) {
  const same = async (body: ReadableStream<Uint8Array> | Response) =>
    Buffer.from(await new Response(body instanceof Response ? body.body : body).arrayBuffer()).equals(probe)
  const attempt = async (step: StorageTestStep, run: () => Promise<boolean | void>) => {
    try {
      return (await run()) === false ? step : null
    } catch (error) {
      console.warn(`[storage test] ${step}:`, error instanceof Error ? error.message : error)
      return step
    }
  }

  const failed = await attempt("write", () => driver.put(path, probe, "text/plain"))
  if (failed) return failed
  const readFailed =
    (await attempt("read", async () => {
      const file = await driver.get(path)
      return !!file && (await same(file.body))
    })) ??
    (checkUrl
      ? await attempt("url", async () => {
          const res = await fetch(driver.publicUrl(path), { cache: "no-store", signal: AbortSignal.timeout(20_000) })
          return res.ok && (await same(res))
        })
      : null)
  const deleteFailed = await attempt("delete", () => driver.remove(path))
  return readFailed ?? deleteFailed
}
