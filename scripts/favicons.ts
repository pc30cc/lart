/**
 * The site's icons, drawn from the "L" of the Limer logo (public/brand/limer-logo.svg):
 * the letter in paper white on the clay colour of the site.
 *
 *   src/app/icon.svg        the browser tab (any size, sharp everywhere)
 *   src/app/favicon.ico     16, 32 and 48 px for older browsers and bookmarks
 *   src/app/apple-icon.png  180 px, a phone's home screen (the phone rounds it)
 *
 * Run again after the logo changes: pnpm icons
 */
import { readFileSync, writeFileSync } from "node:fs"

import sharp from "sharp"

const CLAY = "#a4562f"
const PAPER = "#faf7f2"
const SIZE = 512

const logo = readFileSync("public/brand/limer-logo.svg", "utf8")
const d = logo.match(/ d="([^"]+)"/)?.[1]
if (!d) throw new Error("No path in the logo")

// The "L" fills x 6–880, y 10–1488 of the logo; everything to its right is cut off.
const L = { x: 6, y: 10, w: 880, h: 1478 }
/**
 * `bold`: for 16–48 px, where the logo's hairlines would vanish, the letter gets
 * an outline of its own colour (in logo units) and fills more of the square.
 */
function icon({ rounded, bold = 0 }: { rounded: boolean; bold?: number }) {
  const radius = rounded ? SIZE * 0.22 : 0
  const height = SIZE * (bold ? 0.72 : 0.62)
  const scale = height / L.h
  const width = L.w * scale
  // Optically centred: the foot's serif carries weight to the right, so the letter sits slightly left.
  const left = (SIZE - width) / 2 - SIZE * 0.01
  const top = (SIZE - height) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
<defs><clipPath id="l"><rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}"/></clipPath></defs>
<rect width="${SIZE}" height="${SIZE}" rx="${radius}" fill="${CLAY}"/>
<g transform="translate(${left.toFixed(2)} ${top.toFixed(2)}) scale(${scale.toFixed(6)}) translate(${-L.x} ${-L.y})">
<path clip-path="url(#l)" fill="${PAPER}" fill-rule="evenodd"${bold ? ` stroke="${PAPER}" stroke-width="${bold}" stroke-linejoin="round"` : ""} d="${d}"/>
</g>
</svg>
`
}

/** An .ico holding PNG images (every browser since IE 11 reads them). */
function ico(images: { size: number; png: Buffer }[]) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map((image) => image.png)])
}

async function main() {
  const rounded = icon({ rounded: true })
  writeFileSync("src/app/icon.svg", rounded)

  const png = (svg: string, size: number) =>
    sharp(Buffer.from(svg), { density: 72 * (size / SIZE) * 4 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
  const sizes = [16, 32, 48]
  const small = (size: number) => icon({ rounded: true, bold: size <= 16 ? 70 : size <= 32 ? 45 : 25 })
  writeFileSync("src/app/favicon.ico", ico(await Promise.all(sizes.map(async (size) => ({ size, png: await png(small(size), size) })))))
  writeFileSync("src/app/apple-icon.png", await png(icon({ rounded: false }), 180))
  console.log("Wrote src/app/icon.svg, src/app/favicon.ico and src/app/apple-icon.png")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
