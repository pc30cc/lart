/**
 * The site's icons: a white autumn (maple) leaf on the clay colour of the site.
 *
 *   src/app/icon.svg        the browser tab (any size, sharp everywhere)
 *   src/app/favicon.ico     16, 32 and 48 px for older browsers and bookmarks
 *   src/app/apple-icon.png  180 px, a phone's home screen (the phone rounds it)
 *
 * Run again after changing the leaf or the colours: pnpm icons
 */
import { writeFileSync } from "node:fs"

import sharp from "sharp"

const CLAY = "#a4562f"
const WHITE = "#ffffff"

/**
 * The leaf's outline in a 100 × 100 box: the right half from the top tip down
 * to the stem (tooth, notch, lobe tip, …), mirrored for the left half.
 */
const RIGHT_HALF: [number, number][] = [
  [50, 4],
  [54.5, 13], [59, 11.5], [58.5, 24], // top lobe
  [63, 21.5], [64.5, 30], // notch to the side lobe
  [72, 20], [74.5, 25], [86, 17.5], // side lobe up to its tip
  [82, 31], [89, 33], [80.5, 41], // its outer teeth
  [88, 46.5], [78, 50],
  [69, 50.5], // deep notch to the lower lobe
  [76, 59], [69.5, 60.5], [71, 67], // lower lobe
  [58, 62], [52.5, 66], // into the stem
]
const outline = [...RIGHT_HALF, ...RIGHT_HALF.slice(1).reverse().map(([x, y]): [number, number] => [100 - x, y])]
const LEAF = `M${outline.map(([x, y]) => `${x} ${y}`).join(" L")} Z`
const STEM = "M50 64 Q49 78 46 90"
const VEINS = "M50 63 L50 20 M50 55 L72 31 M50 55 L28 31 M50 60 L68 53 M50 60 L32 53"

/**
 * `small`: for 16–48 px the veins would only blur the leaf, so it is drawn
 * plain and a little larger.
 */
function icon({ rounded, small = false }: { rounded: boolean; small?: boolean }) {
  const radius = rounded ? 22 : 0
  const scale = small ? 0.98 : 0.86
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="${radius}" fill="${CLAY}"/>
<g transform="translate(50 50) rotate(-14) scale(${scale}) translate(-50 -45)">
<path d="${LEAF}" fill="${WHITE}" stroke="${WHITE}" stroke-width="${small ? 3 : 2.2}" stroke-linejoin="round"/>
<path d="${STEM}" fill="none" stroke="${WHITE}" stroke-width="${small ? 5 : 3.4}" stroke-linecap="round"/>
${small ? "" : `<path d="${VEINS}" fill="none" stroke="${CLAY}" stroke-width="1.5" stroke-linecap="round"/>
`}</g>
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

  // Drawn at four times the size, then scaled down: smooth edges.
  const png = (svg: string, size: number) =>
    sharp(Buffer.from(svg), { density: 72 * (size / 100) * 4 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
  const sizes = [16, 32, 48]
  const small = icon({ rounded: true, small: true })
  writeFileSync("src/app/favicon.ico", ico(await Promise.all(sizes.map(async (size) => ({ size, png: await png(small, size) })))))
  writeFileSync("src/app/apple-icon.png", await png(icon({ rounded: false }), 180))
  console.log("Wrote src/app/icon.svg, src/app/favicon.ico and src/app/apple-icon.png")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
