import "server-only"
import { randomBytes } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"

import { StorageError, type Driver } from "./driver"
import { isSafePath, mediaContentType } from "./shared"

/**
 * Development storage: ./.data/public, served by /media/... (the folder kept
 * its name from when there was a private one, so files stored before still open).
 */
export const LOCAL_ROOT = path.join(process.cwd(), ".data", "public")

export type LocalDriver = Driver & {
  /** Absolute file path inside the storage folder; throws for anything that could escape it. */
  file(storagePath: string): string
}

export function localDriver(root = LOCAL_ROOT): LocalDriver {
  const file = (storagePath: string) => {
    const base = path.resolve(root)
    const full = path.resolve(base, storagePath)
    if (!isSafePath(storagePath) || !full.startsWith(base + path.sep)) throw new StorageError("Unsafe storage path")
    return full
  }

  return {
    file,
    async put(storagePath, body) {
      const target = file(storagePath)
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
    async get(storagePath) {
      const target = file(storagePath)
      const info = await stat(target).catch(() => null)
      if (!info?.isFile()) return null
      return {
        body: Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>,
        size: info.size,
        contentType: mediaContentType(storagePath),
      }
    },
    async remove(storagePath) {
      await rm(file(storagePath), { force: true })
    },
    publicUrl: (storagePath) => `/media/${storagePath}`,
  }
}
