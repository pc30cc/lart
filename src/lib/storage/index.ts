import "server-only"
import { randomBytes } from "node:crypto"

import { getSetting, type SettingValue } from "@/lib/settings"
import { bunnyDriver } from "./bunny"
import { StorageError, type Body, type Driver, type StoredFile, type Zone } from "./driver"
import { localDriver } from "./local"
import { r2Driver } from "./r2"
import { isSafePath } from "./shared"

/**
 * Media storage on the CDN chosen in the "cdn" setting (local in development,
 * Bunny Storage or Cloudflare R2). The database stores only the path.
 */

export type { Body, StoredFile, Zone }
export { StorageError }
export * from "./shared"

export type CdnConfig = SettingValue<"cdn">

export type Storage = {
  putPublic(path: string, body: Body, contentType: string): Promise<void>
  putPrivate(path: string, body: Body, contentType: string): Promise<void>
  /** Delete a file; a missing file is not an error. */
  remove(path: string, zone?: Zone): Promise<void>
  /** Public URL (CDN) of a public file. */
  publicUrl(path: string): string
  /** A private file (admins only: serve it through the admin route). */
  readPrivate(path: string): Promise<StoredFile | null>
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
    putPublic: async (path, body, type) => driver.put("public", safe(path), body, type),
    putPrivate: async (path, body, type) => driver.put("private", safe(path), body, type),
    remove: async (path, zone = "public") => driver.remove(zone, safe(path)),
    publicUrl: (path) => driver.publicUrl(safe(path)),
    readPrivate: async (path) => driver.get("private", safe(path)),
  }
}

/** Storage for the current "cdn" setting. Use `publicUrl` of the result for lists. */
export async function getStorage(): Promise<Storage> {
  return createStorage(createDriver(await getSetting("cdn")))
}

export const putPublic = async (path: string, body: Body, contentType: string) =>
  (await getStorage()).putPublic(path, body, contentType)
export const putPrivate = async (path: string, body: Body, contentType: string) =>
  (await getStorage()).putPrivate(path, body, contentType)
export const remove = async (path: string, zone: Zone = "public") => (await getStorage()).remove(path, zone)
export const publicUrl = async (path: string) => (await getStorage()).publicUrl(path)
export const readPrivate = async (path: string) => (await getStorage()).readPrivate(path)

/**
 * A new random, unguessable path: `<prefix>/<yyyy-mm>/<128 random bits>.<ext>`.
 * The original file name never appears in it.
 */
export function newObjectPath(prefix: string, ext: string): string {
  const now = new Date()
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
  const path = `${prefix}/${month}/${randomBytes(16).toString("base64url")}.${ext}`
  if (!isSafePath(path)) throw new Error(`Invalid storage prefix or extension: ${prefix} ${ext}`)
  return path
}

export type StorageTestStep = "config" | "write" | "read" | "url" | "delete"
export type StorageTestResult = { ok: true } | { ok: false; step: StorageTestStep; zone?: Zone }

/**
 * "Test connection" for the settings page: in each zone, write a tiny probe
 * file, read it back (and through the public URL for the public zone), then
 * delete it. Takes the settings shape, keys encrypted. Messages for each
 * failed step are in the "media" namespace under `storageTest`.
 */
export async function testStorage(config: CdnConfig): Promise<StorageTestResult> {
  let driver: Driver
  try {
    driver = createDriver(config)
  } catch {
    return { ok: false, step: "config" }
  }
  for (const zone of ["public", "private"] as const) {
    const path = newObjectPath("_probe", "txt")
    const probe = Buffer.from(randomBytes(16).toString("hex"))
    const step = await probeZone(driver, zone, path, probe, config.provider !== "local")
    if (step) return { ok: false, step, zone }
  }
  return { ok: true }
}

async function probeZone(driver: Driver, zone: Zone, path: string, probe: Buffer, checkUrl: boolean) {
  const same = async (body: ReadableStream<Uint8Array> | Response) =>
    Buffer.from(await new Response(body instanceof Response ? body.body : body).arrayBuffer()).equals(probe)
  const attempt = async (step: StorageTestStep, run: () => Promise<boolean | void>) => {
    try {
      return (await run()) === false ? step : null
    } catch (error) {
      console.warn(`[storage test] ${zone} ${step}:`, error instanceof Error ? error.message : error)
      return step
    }
  }

  const failed = await attempt("write", () => driver.put(zone, path, probe, "text/plain"))
  if (failed) return failed
  const readFailed =
    (await attempt("read", async () => {
      const file = await driver.get(zone, path)
      return !!file && (await same(file.body))
    })) ??
    (zone === "public" && checkUrl
      ? await attempt("url", async () => {
          const res = await fetch(driver.publicUrl(path), { cache: "no-store", signal: AbortSignal.timeout(20_000) })
          return res.ok && (await same(res))
        })
      : null)
  const deleteFailed = await attempt("delete", () => driver.remove(zone, path))
  return readFailed ?? deleteFailed
}
