import "server-only"

import { UploadError } from "./shared"

/**
 * A small streaming multipart/form-data reader for uploads: short text fields
 * first, then one file. The file is exposed as a stream with a byte limit, so
 * a 500 MB video never sits in memory (request.formData() would buffer it all).
 */

export type FormPart = { name: string; filename: string | null; contentType: string | null }

const HEADER_END = Buffer.from("\r\n\r\n")
const MAX_HEADER_BYTES = 16 * 1024
const bad = () => new UploadError("bad_request")

/** The boundary of a multipart/form-data Content-Type header, or null. */
export function multipartBoundary(contentType: string | null): string | null {
  const [type, ...params] = (contentType ?? "").split(";")
  if (type.trim().toLowerCase() !== "multipart/form-data") return null
  for (const param of params) {
    const eq = param.indexOf("=")
    if (eq < 0 || param.slice(0, eq).trim().toLowerCase() !== "boundary") continue
    let value = param.slice(eq + 1).trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    // RFC 2046: 1 to 70 characters from a small set, not ending with a space.
    return /^[0-9A-Za-z'()+_,./:=? -]{1,70}$/.test(value) && !value.endsWith(" ") ? value : null
  }
  return null
}

function headerParam(header: string, key: "name" | "filename"): string | null {
  const quoted = new RegExp(`(?:^|;)\\s*${key}="((?:[^"\\\\]|\\\\.)*)"`, "i").exec(header)
  if (quoted) return quoted[1].replace(/\\(.)/g, "$1")
  const bare = new RegExp(`(?:^|;)\\s*${key}=([^;\\s]+)`, "i").exec(header)
  return bare ? bare[1] : null
}

function parsePartHeaders(head: string): FormPart {
  let disposition: string | null = null
  let contentType: string | null = null
  for (const line of head.split("\r\n")) {
    const colon = line.indexOf(":")
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === "content-disposition") disposition = value
    else if (key === "content-type") contentType = value
  }
  const name = disposition && /^form-data\s*(;|$)/i.test(disposition) ? headerParam(disposition, "name") : null
  if (name === null) throw bad()
  return { name, filename: headerParam(disposition!, "filename"), contentType }
}

export class MultipartReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private readonly delimiter: Buffer
  /** Unread bytes. Starts with CRLF so the first boundary looks like all the others. */
  private buf: Buffer = Buffer.from("\r\n")
  private ended = false

  constructor(body: ReadableStream<Uint8Array>, boundary: string) {
    this.reader = body.getReader()
    this.delimiter = Buffer.from(`\r\n--${boundary}`)
  }

  private async more(): Promise<boolean> {
    if (this.ended) return false
    const { done, value } = await this.reader.read()
    if (done) {
      this.ended = true
      return false
    }
    const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    return true
  }

  /** Headers of the next part, or null after the closing boundary. Skips any unread part data. */
  async next(): Promise<FormPart | null> {
    const d = this.delimiter
    let at: number
    while ((at = this.buf.indexOf(d)) < 0) {
      this.buf = this.buf.subarray(Math.max(0, this.buf.length - d.length))
      if (!(await this.more())) throw bad()
    }
    this.buf = this.buf.subarray(at)
    while (this.buf.length < d.length + 2) if (!(await this.more())) throw bad()
    const after = this.buf.toString("latin1", d.length, d.length + 2)
    if (after === "--") return null
    if (after !== "\r\n") throw bad()
    this.buf = this.buf.subarray(d.length + 2)
    let end: number
    while ((end = this.buf.indexOf(HEADER_END)) < 0) {
      if (this.buf.length > MAX_HEADER_BYTES || !(await this.more())) throw bad()
    }
    if (end > MAX_HEADER_BYTES) throw bad()
    const head = this.buf.toString("utf8", 0, end)
    this.buf = this.buf.subarray(end + HEADER_END.length)
    return parsePartHeaders(head)
  }

  /** The current part as text (a short form field). */
  async text(maxBytes: number): Promise<string> {
    let at: number
    while ((at = this.buf.indexOf(this.delimiter)) < 0) {
      if (this.buf.length > maxBytes + this.delimiter.length || !(await this.more())) throw bad()
    }
    if (at > maxBytes) throw bad()
    const text = this.buf.toString("utf8", 0, at)
    this.buf = this.buf.subarray(at)
    return text
  }

  /**
   * The current part as a stream. It errors with UploadError("too_large") past
   * maxBytes and with "bad_request" when the body ends before the part does
   * (a cut-off upload is never stored).
   */
  file(maxBytes: number): ReadableStream<Uint8Array> {
    const d = this.delimiter
    let sent = 0
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        for (;;) {
          const at = this.buf.indexOf(d)
          // Without a delimiter, keep a tail that could be the start of one.
          const ready = at >= 0 ? at : this.buf.length - d.length
          if (ready > 0) {
            sent += ready
            if (sent > maxBytes) throw new UploadError("too_large")
            controller.enqueue(this.buf.subarray(0, ready))
            this.buf = this.buf.subarray(ready)
          }
          if (at >= 0) return controller.close()
          if (ready > 0) return
          if (!(await this.more())) throw bad()
        }
      },
      cancel: () => this.cancel(),
    })
  }

  /** Stop reading the request body. */
  async cancel() {
    if (this.ended) return
    this.ended = true
    await this.reader.cancel().catch(() => {})
  }
}
