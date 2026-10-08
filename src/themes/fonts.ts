/**
 * The public site's selectable fonts (Settings → Appearance). Pure data, safe
 * in the browser and in the settings schemas.
 *
 * Every font is self-hosted. Inter and IRANSans are the panels' fonts: the root
 * layout already loads them with next/font, so here they only name its CSS
 * variables ("system-serif" names the system's serif fonts, the classic
 * theme's brand). The others are variable woff2 files in public/fonts/<id>/ (with
 * their OFL licence), declared with @font-face only on site pages that use them
 * (src/themes/font-css.ts). A Latin font has a latin and a latin-ext file
 * (Turkish ğ ş İ are in latin-ext); a Persian font has the Arabic-script file.
 * File names carry the font version: bump it when a file changes, they are
 * cached for a year.
 */

export const fontScripts = ["latin", "persian"] as const
export type FontScript = (typeof fontScripts)[number]

type FontFile = {
  /** Path under public/ ("/fonts/…"). */
  src: string
  /** The CSS unicode-range of the file. */
  range: string
  /** Preloaded for pages in this script (one file per font: the one every page needs). */
  preload?: boolean
}

export type FontDef = {
  id: string
  /** Shown in the settings (the font's own name, never translated). */
  label: string
  script: FontScript
  /** Serif fonts get a serif fallback, the others sans-serif. */
  kind: "serif" | "sans"
  /** The weights the settings offer, from the font's range. */
  weights: readonly number[]
  /** Variable fonts: one file covers this weight range ("400 700"). */
  weightRange: string
  /** Self-hosted files (@font-face), or none when `stack` names fonts already there. */
  files: readonly FontFile[]
  /**
   * A ready font-family list instead of files: next/font variables of the root
   * layout (Inter, IRANSans) or the system's serif fonts.
   */
  stack?: string
  /** font-feature-settings the font is made for ("normal" when unset). */
  features?: string
}

const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"
const LATIN_EXT =
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"
const ARABIC =
  "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC"

const latinFiles = (id: string): FontFile[] => [
  { src: `/fonts/${id}/${id}-latin-v5.3.woff2`, range: LATIN, preload: true },
  { src: `/fonts/${id}/${id}-latin-ext-v5.3.woff2`, range: LATIN_EXT },
]

const w = (from: number, to: number) => Array.from({ length: (to - from) / 100 + 1 }, (_, i) => from + i * 100)

export const fonts = [
  // Latin (Turkish and English)
  {
    id: "system-serif",
    label: "Georgia (system serif)",
    script: "latin",
    kind: "serif",
    weights: [400, 500, 700],
    weightRange: "400 700",
    files: [],
    stack: 'ui-serif, Georgia, Cambria, "Times New Roman", Times',
  },
  {
    id: "inter",
    label: "Inter",
    script: "latin",
    kind: "sans",
    weights: w(300, 800),
    weightRange: "100 900",
    files: [],
    stack: "var(--font-inter), var(--font-inter-ext)",
    features: '"cv11", "ss01"',
  },
  { id: "montserrat", label: "Montserrat", script: "latin", kind: "sans", weights: w(300, 800), weightRange: "100 900", files: latinFiles("montserrat") },
  { id: "raleway", label: "Raleway", script: "latin", kind: "sans", weights: w(300, 800), weightRange: "100 900", files: latinFiles("raleway") },
  {
    id: "cormorant-garamond",
    label: "Cormorant Garamond",
    script: "latin",
    kind: "serif",
    weights: w(300, 700),
    weightRange: "300 700",
    files: latinFiles("cormorant-garamond"),
  },
  {
    id: "playfair-display",
    label: "Playfair Display",
    script: "latin",
    kind: "serif",
    weights: w(400, 900),
    weightRange: "400 900",
    files: latinFiles("playfair-display"),
  },
  { id: "lora", label: "Lora", script: "latin", kind: "serif", weights: w(400, 700), weightRange: "400 700", files: latinFiles("lora") },
  // Persian
  { id: "iransans", label: "IRANSans", script: "persian", kind: "sans", weights: [400, 500, 700], weightRange: "400 700", files: [], stack: "var(--font-iransans)" },
  {
    id: "vazirmatn",
    label: "Vazirmatn",
    script: "persian",
    kind: "sans",
    weights: w(300, 800),
    weightRange: "100 900",
    files: [
      { src: "/fonts/vazirmatn/vazirmatn-arabic-v5.3.woff2", range: ARABIC, preload: true },
      { src: "/fonts/vazirmatn/vazirmatn-latin-v5.3.woff2", range: LATIN },
    ],
  },
  {
    id: "noto-naskh-arabic",
    label: "Noto Naskh Arabic",
    script: "persian",
    kind: "serif",
    weights: w(400, 700),
    weightRange: "400 700",
    files: [{ src: "/fonts/noto-naskh-arabic/noto-naskh-arabic-arabic-v5.3.woff2", range: ARABIC, preload: true }],
  },
] as const satisfies readonly FontDef[]

export type FontId = (typeof fonts)[number]["id"]
export const fontIds = fonts.map((f) => f.id) as [FontId, ...FontId[]]
export const latinFontIds = fonts.filter((f) => f.script === "latin").map((f) => f.id)
export const persianFontIds = fonts.filter((f) => f.script === "persian").map((f) => f.id)

const byId = new Map<string, FontDef>(fonts.map((f) => [f.id, f]))

/** The font with this id, or undefined (an id saved before a font was removed). */
export function fontById(id: string): FontDef | undefined {
  return byId.get(id)
}

/** One choice in the settings: a font and its weight. */
export type FontChoice = { id: FontId; weight: number }
/** The heading and the text font of one script. */
export type ScriptFonts = { heading: FontChoice; body: FontChoice }
/** All four choices: Latin (Turkish, English) and Persian. */
export type SiteFonts = Record<FontScript, ScriptFonts>

/** Whether `choice` names a font of `script` and one of its weights. */
export function isValidChoice(choice: { id: string; weight: number }, script: FontScript): boolean {
  const font = fontById(choice.id)
  return Boolean(font && font.script === script && font.weights.includes(choice.weight))
}

/** The script a page's language is written in. */
export const scriptOf = (locale: string): FontScript => (locale === "fa" ? "persian" : "latin")
