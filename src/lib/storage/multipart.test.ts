import { describe, expect, it } from "vitest"

import { MultipartReader, multipartBoundary } from "./multipart"
import { UploadError } from "./shared"

const BOUNDARY = "----WebKitFormBoundaryX3bY9pQ2"

function body(file: Buffer, { purpose = "course_cover", end = true } = {}) {
  return Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}\r\n`),
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="photo (1).jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    file,
    Buffer.from(end ? `\r\n--${BOUNDARY}--\r\n` : ""),
  ])
}

/** A request body stream that delivers the bytes in small chunks, so delimiters cross chunk edges. */
function stream(data: Buffer, chunk = 7) {
  let at = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= data.length) return controller.close()
      controller.enqueue(new Uint8Array(data.subarray(at, at + chunk)))
      at += chunk
    },
  })
}

async function read(data: Buffer, { chunk = 7, max = 1024 * 1024 } = {}) {
  const form = new MultipartReader(stream(data, chunk), BOUNDARY)
  const purposePart = await form.next()
  const purpose = await form.text(64)
  const filePart = await form.next()
  const file = Buffer.from(await new Response(form.file(max)).arrayBuffer())
  const after = await form.next()
  return { purposePart, purpose, filePart, file, after }
}

describe("multipartBoundary", () => {
  it("reads plain and quoted boundaries", () => {
    expect(multipartBoundary(`multipart/form-data; boundary=${BOUNDARY}`)).toBe(BOUNDARY)
    expect(multipartBoundary('Multipart/Form-Data; charset=utf-8; boundary="a b:c"')).toBe("a b:c")
  })
  it.each([null, "application/json", "multipart/form-data", "multipart/mixed; boundary=x", `multipart/form-data; boundary=${"x".repeat(71)}`])(
    "rejects %s",
    (header) => expect(multipartBoundary(header)).toBeNull(),
  )
})

describe("MultipartReader", () => {
  const file = Buffer.concat([Buffer.from("\r\n--almost-a-boundary\r\n--"), Buffer.alloc(5000, 0xab), Buffer.from(`\r\n--${BOUNDARY.slice(0, -1)}`)])

  it.each([1, 7, 64, 100_000])("reads fields and the exact file bytes (chunks of %d)", async (chunk) => {
    const result = await read(body(file), { chunk })
    expect(result.purposePart).toEqual({ name: "purpose", filename: null, contentType: null })
    expect(result.purpose).toBe("course_cover")
    expect(result.filePart).toEqual({ name: "file", filename: "photo (1).jpg", contentType: "image/jpeg" })
    expect(result.file.equals(file)).toBe(true)
    expect(result.after).toBeNull()
  })

  it("reads an empty file", async () => {
    expect((await read(body(Buffer.alloc(0)))).file.length).toBe(0)
  })

  it("stops a file over the limit", async () => {
    await expect(read(body(Buffer.alloc(3000)), { max: 2999 })).rejects.toMatchObject({ code: "too_large" })
    await expect(read(body(Buffer.alloc(3000)), { max: 3000 })).resolves.toBeTruthy()
  })

  it("never accepts a cut-off upload", async () => {
    await expect(read(body(Buffer.alloc(3000), { end: false }))).rejects.toBeInstanceOf(UploadError)
  })

  it("limits text fields", async () => {
    const form = new MultipartReader(stream(body(Buffer.alloc(1), { purpose: "x".repeat(100) })), BOUNDARY)
    await form.next()
    await expect(form.text(64)).rejects.toMatchObject({ code: "bad_request" })
  })

  it("rejects bodies that are not this multipart", async () => {
    const form = new MultipartReader(stream(Buffer.from("not multipart at all")), BOUNDARY)
    await expect(form.next()).rejects.toMatchObject({ code: "bad_request" })
    const noName = new MultipartReader(stream(Buffer.from(`--${BOUNDARY}\r\nContent-Type: text/plain\r\n\r\nx\r\n--${BOUNDARY}--`)), BOUNDARY)
    await expect(noName.next()).rejects.toMatchObject({ code: "bad_request" })
  })

  it("rejects endless part headers", async () => {
    const form = new MultipartReader(stream(Buffer.from(`--${BOUNDARY}\r\nX: ${"a".repeat(20_000)}`), 1000), BOUNDARY)
    await expect(form.next()).rejects.toMatchObject({ code: "bad_request" })
  })
})
