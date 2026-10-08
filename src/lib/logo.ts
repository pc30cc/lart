/**
 * The site's logo (Settings → Appearance): one-colour vector shapes, stored as
 * SVG path data and drawn in the text colour of wherever they show, so one
 * logo suits every theme, light and dark. Made from an uploaded SVG file
 * (src/features/settings/logo-svg.ts). Client-safe: the settings form checks
 * a logo with the same schema the setting is stored with.
 */
import { z } from "zod"

/** The most path data a logo may have in all (characters): it is sent with every page. */
export const LOGO_DATA_MAX = 120_000
/** The most shapes a logo may have. */
export const LOGO_SHAPES_MAX = 600

/** A number as SVG and CSS write it (no trailing dot: "1000." is not one). */
const number = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?`

/** "min-x min-y width height", the size positive. */
const viewBox = z
  .string()
  .max(120)
  .regex(new RegExp(`^${number} ${number} ${number} ${number}$`, "i"))
  .refine((v) => {
    const [, , w, h] = v.split(" ").map(Number)
    return w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)
  })

/** Path data: commands and numbers only (it is drawn as it is, never parsed as markup). */
const pathData = z
  .string()
  .min(1)
  .max(LOGO_DATA_MAX)
  .regex(/^[MmLlHhVvCcSsQqTtAaZz\d.,\s+eE-]+$/)

/** An SVG transform list: the six transform functions and numbers only. */
const transform = z
  .string()
  .max(400)
  .regex(/^[\s,]*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([-+\d.eE,\s]*\)[\s,]*)+$/)

export const logoSchema = z
  .object({
    viewBox,
    paths: z
      .array(z.object({ d: pathData, evenodd: z.literal(true).optional(), transform: transform.optional() }))
      .min(1)
      .max(LOGO_SHAPES_MAX),
  })
  .refine((logo) => logo.paths.reduce((sum, p) => sum + p.d.length, 0) <= LOGO_DATA_MAX)

export type LogoData = z.infer<typeof logoSchema>

/** The logo's size (its viewBox's), what themes lay it out with; the shapes are drawn by `#site-logo`. */
export type LogoSize = { width: number; height: number }

export function logoSize(logo: LogoData): LogoSize {
  const [, , width, height] = logo.viewBox.split(" ").map(Number)
  return { width, height }
}
