/**
 * Atelier's own photos (public/themes/atelier/), used wherever the admin has
 * not uploaded one (Settings → Home page): the hero's slideshow and the
 * sections' backgrounds. This list is the only place that names them.
 *
 * To add or swap a photo: put a webp in public/themes/atelier/ (resized with
 * sharp: 1920px wide for the hero, 1600px for the others, under 300 KB) with
 * a version in its name (`pottery-hall.v1.webp`; the files are cached for a
 * year, so a changed photo gets a new name), describe it below and use it in
 * `atelierPhotos`. `alt` picks a text from messages/<locale>/home.json →
 * atelier.photos (one per subject); `focus` is the point that stays in view
 * when the photo is cropped (a phone shows a narrow slice of a wide photo).
 */

/** The photos' descriptions (messages: home.atelier.photos.<key>). */
export type AtelierPhotoAlt =
  | "candlesPouring"
  | "candlesTable"
  | "candlesFriends"
  | "pottery"
  | "macrame"
  | "painting"
  | "studio"
  | "closeUp"

export type AtelierPhoto = {
  /** Path under public/. */
  src: string
  width: number
  height: number
  alt: AtelierPhotoAlt
  /** CSS object-position: the part that matters ("50% 50%" when unset). */
  focus?: string
}

const photo = (file: string, width: number, height: number, alt: AtelierPhotoAlt, focus?: string): AtelierPhoto => ({
  src: `/themes/atelier/${file}`,
  width,
  height,
  alt,
  focus,
})

const candlesPouring = photo("candles-wide.v1.webp", 1920, 1088, "candlesPouring", "42% 50%")
const candlesTable = photo("candles-table.v1.webp", 1344, 768, "candlesTable", "40% 50%")
const candlesFriends = photo("candles-friends.v1.webp", 1344, 768, "candlesFriends", "48% 40%")

export const atelierPhotos = {
  /** The hero's slideshow, in order (about 7 seconds each). */
  hero: [candlesPouring, candlesTable, candlesFriends],
  /** The story band ("A place to create together"). */
  story: candlesFriends,
  /** The "Explore by craft" band behind the category buttons. */
  crafts: candlesTable,
  /** The "How it works" band behind the four steps. */
  steps: candlesPouring,
  /**
   * A workshop card without a cover. null: a quiet monogram in the palette
   * (a photo of one craft would mislead on a card of another).
   */
  card: null as AtelierPhoto | null,
} satisfies Record<string, AtelierPhoto | AtelierPhoto[] | null>
