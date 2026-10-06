import "server-only"

/** Public files are served by the CDN; private files (originals, logo) only through the admin route. */
export type Zone = "public" | "private"

/** A Blob may be file-backed (fs.openAsBlob), so large videos stream from disk. */
export type Body = Uint8Array | Blob

export type StoredFile = {
  body: ReadableStream<Uint8Array>
  size: number | null
  contentType: string | null
}

export interface Driver {
  put(zone: Zone, path: string, body: Body, contentType: string): Promise<void>
  /** The file, or null when it does not exist. */
  get(zone: Zone, path: string): Promise<StoredFile | null>
  /** Deleting a missing file is not an error. */
  remove(zone: Zone, path: string): Promise<void>
  publicUrl(path: string): string
}

/** A storage provider failed. The message never contains keys. */
export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StorageError"
  }
}

/** Long uploads (videos) and downloads get more time than small requests. */
export function timeout(body?: Body | null) {
  return AbortSignal.timeout(body instanceof Blob && body.size > 20 * 1024 * 1024 ? 30 * 60_000 : 2 * 60_000)
}

export const IMMUTABLE = "public, max-age=31536000, immutable"

export async function expectOk(res: Response, what: string) {
  if (res.ok) return
  await res.body?.cancel().catch(() => {})
  throw new StorageError(`${what} failed: HTTP ${res.status}`)
}

export function storedFile(res: Response): StoredFile | null {
  if (!res.body) return null
  const length = Number(res.headers.get("content-length"))
  return {
    body: res.body,
    size: Number.isSafeInteger(length) && length >= 0 && res.headers.has("content-length") ? length : null,
    contentType: res.headers.get("content-type"),
  }
}
