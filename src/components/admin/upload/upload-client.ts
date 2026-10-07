"use client"

import { useFormatter, useTranslations } from "next-intl"
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react"

import {
  folderName,
  isImagePurpose,
  MAX_MEGAPIXELS,
  maxUploadBytes,
  VIDEO_PART_BYTES,
  type UploadErrorCode,
  type UploadPurpose,
  type UploadResult,
  type UploadTarget,
  type VideoPartReceived,
} from "@/lib/storage/shared"

/** Errors the user is told about: the server's codes plus a lost connection. */
export type ClientUploadError = UploadErrorCode | "network"

class UploadFailure extends Error {
  constructor(readonly code: ClientUploadError | "aborted") {
    super(code)
  }
}

const IMAGE_TYPE = /^image\/(jpeg|png|webp|avif|heic|heif)$/
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|heic|heif)$/i
const VIDEO_TYPE = /^video\/(mp4|quicktime|webm)$/
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i

export const isVideoFile = (file: File) => VIDEO_TYPE.test(file.type) || VIDEO_EXT.test(file.name)
const isImageFile = (file: File) => IMAGE_TYPE.test(file.type) || IMAGE_EXT.test(file.name)

/** Quick checks before sending anything; the server checks the real content again. */
export function checkFile(file: File, purpose: UploadPurpose): ClientUploadError | null {
  if (!file.size || !(isImagePurpose(purpose) ? isImageFile(file) : isVideoFile(file))) return "unsupported_type"
  if (file.size > maxUploadBytes(purpose)) return "too_large"
  return null
}

/** Upload routes: the super-admin panel's (default) and the instructor panel's (profile photo only). */
export type UploadEndpoint = "/api/admin/uploads" | "/api/instructor/uploads"

type Options = {
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  /** Where to send it; the admin route unless given. */
  endpoint?: UploadEndpoint
  /** Whose folder it goes to (the admin route). */
  target?: UploadTarget
}
type Answer = { status: number; body: unknown }

/** One POST to the upload route with upload progress (fetch cannot report it). */
function send(
  fields: Record<string, string>,
  file: Blob,
  name: string,
  { onProgress, signal, endpoint = "/api/admin/uploads" }: Options,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new UploadFailure("aborted"))
    const xhr = new XMLHttpRequest()
    xhr.open("POST", endpoint)
    xhr.responseType = "json"
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total)
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.response })
    xhr.onerror = () => reject(new UploadFailure("network"))
    xhr.onabort = () => reject(new UploadFailure("aborted"))
    signal?.addEventListener("abort", () => xhr.abort(), { once: true })
    // Text fields first, then the file: the server streams the file.
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.append(key, value)
    form.append("file", file, name)
    xhr.send(form)
  })
}

/** The target as form fields; a folder name is sent already short and safe (the route takes 64 bytes per field). */
function targetFields({ courseId, instructorId, folder }: UploadTarget = {}): Record<string, string> {
  const fields: Record<string, string> = {}
  if (courseId) fields.courseId = courseId
  if (instructorId) fields.instructorId = instructorId
  const name = folderName([folder], "")
  if (name) fields.folder = name
  return fields
}

const failure = ({ status, body }: Answer) =>
  new UploadFailure((body as { error?: ClientUploadError } | null)?.error ?? (status === 413 ? "too_large" : "server"))

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(new UploadFailure("aborted"))
    }
    signal?.addEventListener("abort", abort, { once: true })
  })

/**
 * Upload a file for a purpose. Videos go in parts of VIDEO_PART_BYTES, so no
 * request is long enough to be cut by a proxy; a dropped connection is
 * retried and the upload continues where the server says it is. A failure
 * carries the server's error code (`failureCode`), e.g. "too_large", or
 * "rate_limited" from the instructor route.
 */
export async function uploadFile(file: File, purpose: UploadPurpose, options: Options = {}): Promise<UploadResult> {
  if (isImagePurpose(purpose)) {
    const answer = await send({ purpose, ...targetFields(options.target) }, file, file.name, options)
    if (answer.status === 201) return answer.body as UploadResult
    throw failure(answer)
  }

  let upload: string | undefined
  let offset = 0
  for (let attempt = 0; ; ) {
    const part = file.slice(offset, offset + VIDEO_PART_BYTES)
    const fields: Record<string, string> = { purpose, ...targetFields(options.target), total: String(file.size) }
    if (upload) Object.assign(fields, { upload, offset: String(offset) })
    let answer: Answer
    try {
      answer = await send(fields, part, file.name, {
        signal: options.signal,
        endpoint: options.endpoint,
        onProgress: (fraction) => options.onProgress?.((offset + fraction * part.size) / file.size),
      })
    } catch (error) {
      if (failureCode(error) !== "network" || attempt >= 4) throw error
      await wait(1000 * 2 ** attempt++, options.signal)
      continue
    }
    if (answer.status === 201) return answer.body as UploadResult
    if (answer.status !== 202 && answer.status !== 409) throw failure(answer)
    const received = answer.body as VideoPartReceived
    if (answer.status === 202 && received.received <= offset) throw new UploadFailure("server")
    upload = received.upload
    offset = received.received
    attempt = 0
  }
}

export const failureCode = (error: unknown): ClientUploadError | "aborted" =>
  error instanceof UploadFailure ? error.code : "server"

/** Texts of the "media" namespace plus friendly sizes and error messages. */
export function useMediaText() {
  const t = useTranslations("media")
  const format = useFormatter()
  const size = useCallback(
    (bytes: number) =>
      format.number(bytes / (1024 * 1024), {
        style: "unit",
        unit: "megabyte",
        maximumFractionDigits: bytes < 10 * 1024 * 1024 ? 1 : 0,
      }),
    [format],
  )
  const error = useCallback(
    (code: ClientUploadError, purpose: UploadPurpose) =>
      t(`errors.${code}`, {
        size: size(maxUploadBytes(purpose)),
        kind: isImagePurpose(purpose) ? "image" : "video",
        megapixels: MAX_MEGAPIXELS,
      }),
    [t, size],
  )
  return { t, size, error }
}

export type SingleUploadPhase =
  | { kind: "idle" }
  | { kind: "uploading"; file: File; preview: string; progress: number }
  | { kind: "error"; code: ClientUploadError; file?: File }

/**
 * One file at a time: progress, cancel, retry, and a local preview while it
 * uploads. `target` is read when an upload starts (e.g. the slug typed so far).
 */
export function useSingleUpload(
  purpose: UploadPurpose,
  onDone: (result: UploadResult) => void,
  endpoint?: UploadEndpoint,
  target?: UploadTarget,
) {
  const [phase, setPhase] = useState<SingleUploadPhase>({ kind: "idle" })
  const controller = useRef<AbortController | null>(null)
  const preview = useRef<string | null>(null)
  const done = useRef(onDone)
  const targetRef = useRef(target)
  useEffect(() => {
    done.current = onDone
    targetRef.current = target
  })
  useEffect(
    () => () => {
      controller.current?.abort()
      if (preview.current) URL.revokeObjectURL(preview.current)
    },
    [],
  )

  const start = useCallback(
    async (file: File) => {
      const problem = checkFile(file, purpose)
      if (problem) return setPhase({ kind: "error", code: problem })

      controller.current?.abort()
      const own = new AbortController()
      controller.current = own
      if (preview.current) URL.revokeObjectURL(preview.current)
      const url = URL.createObjectURL(file)
      preview.current = url
      setPhase({ kind: "uploading", file, preview: url, progress: 0 })

      try {
        const result = await uploadFile(file, purpose, {
          signal: own.signal,
          endpoint,
          target: targetRef.current,
          onProgress: (progress) => setPhase((p) => (p.kind === "uploading" && p.file === file ? { ...p, progress } : p)),
        })
        if (controller.current !== own) return
        setPhase({ kind: "idle" })
        done.current(result)
      } catch (error) {
        if (controller.current !== own) return
        const code = failureCode(error)
        setPhase(code === "aborted" ? { kind: "idle" } : { kind: "error", code, file })
      } finally {
        if (preview.current === url) {
          URL.revokeObjectURL(url)
          preview.current = null
        }
      }
    },
    [purpose, endpoint],
  )

  const cancel = useCallback(() => controller.current?.abort(), [])
  const dismiss = useCallback(() => setPhase({ kind: "idle" }), [])
  return { phase, start, cancel, dismiss }
}

/** Drag-and-drop of files from the computer onto an element. */
export function useFileDrop(onFiles: (files: File[]) => void, disabled?: boolean) {
  const [dragging, setDragging] = useState(false)
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files")
  return {
    dragging,
    dropProps: {
      onDragOver: (event: DragEvent) => {
        if (disabled || !hasFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
        setDragging(true)
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      },
      onDrop: (event: DragEvent) => {
        if (disabled || !hasFiles(event)) return
        event.preventDefault()
        setDragging(false)
        const files = Array.from(event.dataTransfer.files)
        if (files.length) onFiles(files)
      },
    },
  }
}
