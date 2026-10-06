import { describe, expect, it } from "vitest"

import { sniffImage, sniffVideo } from "./sniff"

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))))

/** An ISO-BMFF ftyp box followed by some payload. */
const ftyp = (major: string, ...compatible: string[]) => {
  const size = 16 + 4 * compatible.length
  return bytes([0, 0, 0, size], "ftyp", major, [0, 0, 2, 0], ...compatible, "\0\0\0\x08free")
}

describe("sniffImage", () => {
  it.each([
    ["jpeg", bytes([0xff, 0xd8, 0xff, 0xe0], "\0\x10JFIF")],
    ["png", bytes("\x89PNG\r\n\x1a\n", "\0\0\0\rIHDR")],
    ["webp", bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ")],
    ["avif", ftyp("avif", "mif1", "miaf")],
    ["avif", ftyp("mif1", "avif")],
    ["heic", ftyp("heic", "mif1", "heic")],
    ["heic", ftyp("mif1", "heic")],
  ])("detects %s", (type, input) => expect(sniffImage(input)).toBe(type))

  it.each([
    ["gif", bytes("GIF89a\x01\0\x01\0")],
    ["svg", bytes('<svg xmlns="http://www.w3.org/2000/svg">')],
    ["html with an image name", bytes("<!doctype html><script>")],
    ["pdf", bytes("%PDF-1.7")],
    ["mp4 video", ftyp("isom", "isom", "mp41")],
    ["empty", bytes()],
    ["truncated png", bytes("\x89PN")],
  ])("rejects %s", (_, input) => expect(sniffImage(input)).toBeNull())
})

describe("sniffVideo", () => {
  it.each([
    ["mp4", ftyp("isom", "isom", "iso2", "avc1", "mp41")],
    ["mp4", ftyp("mp42", "mp42", "isom")],
    ["mov", ftyp("qt  ", "qt  ")],
    ["webm", bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], "webm", [0x42, 0x87])],
  ])("detects %s", (type, input) => expect(sniffVideo(input)).toBe(type))

  it.each([
    ["matroska", bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88], "matroska")],
    ["heic image", ftyp("heic", "mif1", "heic")],
    ["avif image", ftyp("avif", "mif1")],
    ["jpeg", bytes([0xff, 0xd8, 0xff, 0xe0])],
    ["executable", bytes("MZ\x90\0")],
    ["ftyp-like text", bytes("....ftyp-not-a-video")],
    ["empty", bytes()],
  ])("rejects %s", (_, input) => expect(sniffVideo(input)).toBeNull())
})
