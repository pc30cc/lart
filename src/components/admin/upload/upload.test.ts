import { readFileSync } from "node:fs"
import path from "node:path"
import { NextIntlClientProvider } from "next-intl"
import { createElement, type ComponentProps, type ReactElement } from "react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { VIDEO_PART_BYTES } from "@/lib/storage/shared"
import { ImageUpload, MediaGrid, VideoUpload } from "./index"
import { checkFile, uploadFile } from "./upload-client"

const messages = (locale: string) => ({
  media: JSON.parse(readFileSync(path.join(process.cwd(), "messages", locale, "media.json"), "utf8")),
})

function render(locale: string, element: ReactElement) {
  const errors: unknown[] = []
  const props: ComponentProps<typeof NextIntlClientProvider> = {
    locale,
    messages: messages(locale),
    timeZone: "Europe/Istanbul",
    onError: (e) => void errors.push(e),
    children: element,
  }
  const html = renderToString(createElement(NextIntlClientProvider, props))
  expect(errors).toEqual([])
  return html
}

describe("upload components", () => {
  const noop = () => {}
  it.each(["fa", "tr", "en"])("render in %s without missing or broken messages", (locale) => {
    const empty = render(locale, createElement(ImageUpload, { purpose: "course_cover", value: null, onChange: noop }))
    expect(empty).toContain('type="file"')
    const filled = render(
      locale,
      createElement(ImageUpload, { purpose: "watermark_logo", value: "brand/2026-10/a.png", previewUrl: "/x.png", onChange: noop }),
    )
    expect(filled).toContain('src="/x.png"')
    render(locale, createElement(VideoUpload, { value: null, onChange: noop }))
    render(locale, createElement(VideoUpload, { value: "gallery/2026-10/a.mp4", previewUrl: "/a.mp4", onChange: noop }))
    render(locale, createElement(MediaGrid, { value: [], onChange: noop }))
    const grid = render(
      locale,
      createElement(MediaGrid, {
        value: [
          { path: "gallery/2026-10/a.webp", url: "/a.webp", kind: "image" },
          { path: "gallery/2026-10/b.mp4", url: "/b.mp4", kind: "video" },
        ],
        onChange: noop,
      }),
    )
    expect(grid).toContain('src="/a.webp"')
  })

  it("uses every message key in all three languages", () => {
    const keys = (o: object, prefix = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
    const [fa, tr, en] = ["fa", "tr", "en"].map((l) => keys(messages(l).media).sort())
    expect(fa).toEqual(en)
    expect(tr).toEqual(en)
  })
})

describe("checkFile", () => {
  const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type })
  it("accepts photos and videos by type or extension", () => {
    expect(checkFile(file("a.jpg", "image/jpeg"), "course_cover")).toBeNull()
    expect(checkFile(file("IMG_1.HEIC", ""), "gallery_photo")).toBeNull()
    expect(checkFile(file("clip.mov", "video/quicktime"), "gallery_video")).toBeNull()
  })
  it("refuses wrong kinds, empty and oversized files", () => {
    expect(checkFile(file("a.gif", "image/gif"), "course_cover")).toBe("unsupported_type")
    expect(checkFile(file("a.jpg", "image/jpeg"), "gallery_video")).toBe("unsupported_type")
    expect(checkFile(file("a.jpg", "image/jpeg", 0), "course_cover")).toBe("unsupported_type")
    expect(checkFile(file("a.jpg", "image/jpeg", 15 * 1024 * 1024 + 1), "course_cover")).toBe("too_large")
  })
})

describe("uploadFile", () => {
  afterEach(() => vi.unstubAllGlobals())

  /** A fake XMLHttpRequest answering with the given handler. */
  function fakeXhr(answer: (form: FormData, call: number) => { status: number; body: unknown } | "network") {
    const sent: FormData[] = []
    class FakeXhr {
      status = 0
      response: unknown = null
      responseType = ""
      upload = { onprogress: null as ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      open() {}
      abort() {
        this.onabort?.()
      }
      send(form: FormData) {
        sent.push(form)
        const result = answer(form, sent.length)
        queueMicrotask(() => {
          if (result === "network") return this.onerror?.()
          this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 })
          this.status = result.status
          this.response = result.body
          this.onload?.()
        })
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr)
    return sent
  }

  it("sends a photo in one request, purpose first", async () => {
    const sent = fakeXhr(() => ({ status: 201, body: { path: "courses/x.webp", url: "/media/courses/x.webp" } }))
    const result = await uploadFile(new File(["x"], "a.jpg", { type: "image/jpeg" }), "course_cover")
    expect(result.path).toBe("courses/x.webp")
    expect([...sent[0].keys()]).toEqual(["purpose", "file"])
  })

  it("maps server errors to friendly codes", async () => {
    fakeXhr(() => ({ status: 415, body: { error: "unsupported_type" } }))
    await expect(uploadFile(new File(["x"], "a.jpg"), "course_cover")).rejects.toMatchObject({ code: "unsupported_type" })
  })

  it("reports a gallery photo refused for a missing watermark logo (409 is not a video receipt here)", async () => {
    fakeXhr(() => ({ status: 409, body: { error: "watermark_missing" } }))
    await expect(uploadFile(new File(["x"], "a.jpg"), "gallery_photo")).rejects.toMatchObject({ code: "watermark_missing" })
  })

  it("sends a video in parts, retries a dropped part and follows the server's offset", async () => {
    vi.useFakeTimers()
    const size = 2 * VIDEO_PART_BYTES + 5
    const progress: number[] = []
    const sent = fakeXhr((form, call) => {
      const offset = Number(form.get("offset") ?? 0)
      const part = form.get("file") as File
      if (call === 2) return "network" // the second part's connection drops
      if (call === 3) return { status: 409, body: { upload: "U".repeat(22), received: offset + part.size } } // it had arrived
      const received = offset + part.size
      return received < size ? { status: 202, body: { upload: "U".repeat(22), received } } : { status: 201, body: { path: "gallery/v.mp4", url: "/v.mp4" } }
    })
    const done = uploadFile(new File([new Uint8Array(size)], "clip.mp4", { type: "video/mp4" }), "gallery_video", {
      onProgress: (p) => progress.push(p),
    })
    await vi.runAllTimersAsync()
    expect((await done).path).toBe("gallery/v.mp4")
    vi.useRealTimers()

    const fields = sent.map((form) => [form.get("upload"), form.get("offset"), (form.get("file") as File).size])
    expect(fields).toEqual([
      [null, null, VIDEO_PART_BYTES],
      ["U".repeat(22), String(VIDEO_PART_BYTES), VIDEO_PART_BYTES],
      ["U".repeat(22), String(VIDEO_PART_BYTES), VIDEO_PART_BYTES],
      ["U".repeat(22), String(2 * VIDEO_PART_BYTES), 5],
    ])
    expect(sent.every((form) => form.get("total") === String(size) && [...form.keys()].at(-1) === "file")).toBe(true)
    expect(progress.at(-1)).toBe(1)
  })
})
