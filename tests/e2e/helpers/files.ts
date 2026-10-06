import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import sharp from "sharp"

import { E2E_DIR } from "./app"

/** Generated test files live in the git-ignored scratch folder. */
const DIR = path.join(E2E_DIR, "fixtures")

const FFMPEG = ["/usr/bin/ffmpeg", "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux"]

/**
 * A JPEG photo (a soft gradient with a few shapes), with EXIF orientation and
 * GPS-like metadata so the upload pipeline has something to strip.
 */
export async function makePhoto(name: string, width = 1600, height = 1200, hue = 20): Promise<string> {
  fs.mkdirSync(DIR, { recursive: true })
  const file = path.join(DIR, name)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},70%,75%)"/><stop offset="1" stop-color="hsl(${hue + 40},60%,35%)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${width * 0.35}" cy="${height * 0.45}" r="${height * 0.22}" fill="hsl(${hue + 180},50%,60%)" opacity="0.8"/>
    <rect x="${width * 0.55}" y="${height * 0.3}" width="${width * 0.25}" height="${height * 0.4}" rx="30" fill="#fff" opacity="0.6"/>
  </svg>`
  await sharp(Buffer.from(svg))
    .jpeg({ quality: 85 })
    .withMetadata({ exif: { IFD0: { Artist: "e2e", Copyright: "GPS 41.0082N 28.9784E" } } })
    .toFile(file)
  return file
}

/** A transparent PNG logo with the word "LART". */
export async function makeLogo(name = "logo.png"): Promise<string> {
  fs.mkdirSync(DIR, { recursive: true })
  const file = path.join(DIR, name)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
    <rect x="10" y="10" width="580" height="180" rx="40" fill="none" stroke="#ffffff" stroke-width="14"/>
    <text x="300" y="135" font-family="sans-serif" font-size="110" font-weight="700" fill="#ffffff" text-anchor="middle">LART</text>
  </svg>`
  await sharp(Buffer.from(svg)).png().toFile(file)
  return file
}

/** A 2-second 320x240 MP4 (H.264), a WebM (VP8) when no ffmpeg here can encode H.264, or null without ffmpeg. */
export function makeVideo(name = "clip.mp4"): string | null {
  fs.mkdirSync(DIR, { recursive: true })
  const file = path.join(DIR, name)
  if (fs.existsSync(file)) return file
  const source = ["-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15"]
  const attempts: [string, string[]][] = [
    [file, [...source, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart"]],
    // The Playwright ffmpeg build has no libx264: VP8 in WebM instead.
    [file.replace(/\.mp4$/, ".webm"), [...source, "-c:v", "libvpx"]],
  ]
  for (const [out, args] of attempts) {
    for (const bin of FFMPEG.filter((b) => fs.existsSync(b))) {
      try {
        execFileSync(bin, ["-y", ...args, out], { stdio: "ignore" })
        return out
      } catch {
        // try the next binary / format
      }
    }
  }
  return null
}
