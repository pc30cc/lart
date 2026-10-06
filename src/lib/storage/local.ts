import "server-only"
import { randomBytes } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"

import { StorageError, type Driver, type Zone } from "./driver"
import { isSafePath, mediaContentType } from "./shared"

/** Development storage: ./.data/public (served by /media/...) and ./.data/private. */
export const LOCAL_ROOT = path.join(process.cwd(), ".data")

export type LocalDriver = Driver & {
  /** Absolute file path inside the zone folder; throws for anything that could escape it. */
  file(zone: Zone, storagePath: string): string
}

export function localDriver(root = LOCAL_ROOT): LocalDriver {
  const file = (zone: Zone, storagePath: string) => {
    const base = path.resolve(root, zone)
    const full = path.resolve(base, storagePath)
    if (!isSafePath(storagePath) || !full.startsWith(base + path.sep)) throw new StorageError("Unsafe storage path")
    return full
  }

  return {
    file,
    async put(zone, storagePath, body) {
      const target = file(zone, storagePath)
      await mkdir(path.dirname(target), { recursive: true })
      // Write to a temporary name first so a half-written file is never served.
      const temp = `${target}.${randomBytes(6).toString("hex")}.part`
      try {
        if (body instanceof Blob) {
          await pipeline(Readable.fromWeb(body.stream() as NodeReadableStream), createWriteStream(temp, { mode: 0o600 }))
        } else {
          await writeFile(temp, body, { mode: 0o600 })
        }
        await rename(temp, target)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
    },
    async get(zone, storagePath) {
      const target = file(zone, storagePath)
      const info = await stat(target).catch(() => null)
      if (!info?.isFile()) return null
      return {
        body: Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>,
        size: info.size,
        contentType: mediaContentType(storagePath),
      }
    },
    async remove(zone, storagePath) {
      await rm(file(zone, storagePath), { force: true })
    },
    publicUrl: (storagePath) => `/media/${storagePath}`,
  }
}
