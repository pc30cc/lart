/**
 * File type detection from the first bytes of the content ("magic bytes").
 * The browser's file name and MIME type are never trusted.
 */

export type ImageType = "jpeg" | "png" | "webp" | "avif" | "heic"
export type VideoType = "mp4" | "mov" | "webm"

/** How many leading bytes the sniffers need. */
export const SNIFF_BYTES = 64

const ascii = (b: Uint8Array, start: number, end: number) =>
  b.length < end ? "" : String.fromCharCode(...b.subarray(start, end))

/** Brands of an ISO-BMFF `ftyp` box (MP4, MOV, AVIF, HEIC): [major, ...compatible]. */
function ftypBrands(b: Uint8Array): string[] {
  if (ascii(b, 4, 8) !== "ftyp") return []
  const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
  const end = Math.min(size, b.length)
  const brands = [ascii(b, 8, 12)]
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i, i + 4))
  return brands
}

const AVIF_BRANDS = new Set(["avif", "avis"])
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"])

export function sniffImage(b: Uint8Array): ImageType | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg"
  if (ascii(b, 0, 8) === "\x89PNG\r\n\x1a\n") return "png"
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp"
  const brands = ftypBrands(b)
  if (brands.some((x) => AVIF_BRANDS.has(x))) return "avif"
  if (brands.some((x) => HEIC_BRANDS.has(x))) return "heic"
  return null
}

const MP4_BRANDS = new Set([
  "isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VH", "M4VP",
  "dash", "mmp4", "MSNV", "XAVC", "3gp4", "3gp5", "3gp6", "3g2a", "f4v ",
])

export function sniffVideo(b: Uint8Array): VideoType | null {
  const [major] = ftypBrands(b)
  if (major === "qt  ") return "mov"
  if (major && MP4_BRANDS.has(major)) return "mp4"
  // WebM: EBML header whose DocType element (0x4282) is "webm" (Matroska is not accepted).
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    for (let i = 4; i + 3 < Math.min(b.length, SNIFF_BYTES); i++) {
      if (b[i] !== 0x42 || b[i + 1] !== 0x82) continue
      const len = b[i + 2] & 0x7f // one-byte size (0x80 | n)
      return (b[i + 2] & 0x80) && ascii(b, i + 3, i + 3 + len).replace(/\0+$/, "") === "webm" ? "webm" : null
    }
  }
  return null
}

export const videoContentType: Record<VideoType, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
}
