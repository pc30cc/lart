/**
 * Upload purposes, limits and path rules. Shared by the server (upload API,
 * storage drivers) and the upload components, so no server code here.
 */

export const imagePurposes = [
  "instructor_photo",
  "course_cover",
  "course_sample",
  "gallery_photo",
  "watermark_logo",
] as const
export type ImagePurpose = (typeof imagePurposes)[number]

export const uploadPurposes = [...imagePurposes, "gallery_video"] as const
export type UploadPurpose = (typeof uploadPurposes)[number]

export const isImagePurpose = (purpose: UploadPurpose): purpose is ImagePurpose =>
  purpose !== "gallery_video"

const MB = 1024 * 1024
export const MAX_IMAGE_BYTES = 15 * MB
export const MAX_VIDEO_BYTES = 500 * MB
export const maxUploadBytes = (purpose: UploadPurpose) =>
  isImagePurpose(purpose) ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
/** Larger images are refused before decoding (every phone camera fits; decompression bombs do not). */
export const MAX_MEGAPIXELS = 70
/**
 * Videos are sent in parts of this size: each request stays short, so the
 * reverse proxy (Traefik: 60 s read timeout) and Node (300 s) never cut it.
 */
export const VIDEO_PART_BYTES = 8 * MB

/** For `<input accept>`. The server checks the real type from the content. */
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,.heic,.heif"
export const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"

/** JSON answer of POST /api/admin/uploads. */
export type UploadResult = {
  /** Storage path to save in the database. */
  path: string
  /** Where the file can be seen: the CDN for public files, the admin-only route for private ones. */
  url: string
  width?: number
  height?: number
  /** gallery_photo only: the unwatermarked original in private storage. */
  originalPath?: string
}

/** Answer for a video part that is not the last one (HTTP 202), or after an offset mismatch (409). */
export type VideoPartReceived = { upload: string; received: number }

export const uploadErrorStatus = {
  unauthorized: 401,
  bad_request: 400,
  too_large: 413,
  unsupported_type: 415,
  heic_unsupported: 415,
  too_many_pixels: 422,
  invalid_image: 422,
  /** A gallery photo while no watermark logo is set: it is never published unwatermarked. */
  watermark_missing: 409,
  watermark_unavailable: 503,
  storage: 502,
  server: 500,
} as const
export type UploadErrorCode = keyof typeof uploadErrorStatus

/** A failure the user can be told about (the code maps to a friendly message). */
export class UploadError extends Error {
  readonly status: number
  constructor(readonly code: UploadErrorCode) {
    super(code)
    this.name = "UploadError"
    this.status = uploadErrorStatus[code]
  }
}

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/
const FILE = /^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{2,5}$/

/**
 * Storage paths look like `gallery/2026-10/<random>.webp`: 2 to 6 segments of
 * [A-Za-z0-9_-], a dot only before the extension. No "..", no leading slash,
 * no backslash, no encoded characters, so a path can never leave its zone.
 */
export function isSafePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length > 255) return false
  const parts = path.split("/")
  if (parts.length < 2 || parts.length > 6) return false
  return parts.every((part, i) => (i === parts.length - 1 ? FILE : SEGMENT).test(part))
}

/** URL of a private file (admins only), e.g. an original photo or the watermark logo. */
export const privateUrl = (path: string) => `/api/admin/media/private/${path}`

const contentTypes: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
}

/** Content type of a stored media file from its extension, or null for anything else. */
export function mediaContentType(path: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1)
  return Object.hasOwn(contentTypes, ext) ? contentTypes[ext] : null
}
