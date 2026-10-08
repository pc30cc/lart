import { type FontChoice, type FontDef, fontById, type FontScript, type SiteFonts } from "./fonts"

/**
 * The CSS for the site's chosen fonts: @font-face for the self-hosted files of
 * the chosen fonts only, and the variables the site's styles read
 * (globals.css, `[data-site-theme]`):
 *
 * - `--site-font-heading`, `--site-font-heading-weight`
 * - `--site-font-body`, `--site-font-body-weight`, `--site-font-features`
 *
 * for Latin pages, and again under `:lang(fa)` for Persian pages. Every value
 * comes from the font registry, never from what an admin typed.
 */
export function siteFontCss(choices: SiteFonts): string {
  const used = new Map<string, FontDef>()
  for (const script of ["latin", "persian"] as const) {
    for (const part of ["heading", "body"] as const) {
      const font = fontById(choices[script][part].id)
      if (font) used.set(font.id, font)
    }
  }

  const faces = [...used.values()].flatMap((font) =>
    font.files.map(
      (file) =>
        `@font-face{font-family:${familyName(font)};font-style:normal;font-display:swap;font-weight:${font.weightRange};src:url(${file.src}) format("woff2");unicode-range:${file.range}}`,
    ),
  )

  const vars = (script: FontScript) => {
    const { heading, body } = choices[script]
    const latin = choices.latin
    // A Persian page also shows Latin words (venues, names): they fall back to the Latin fonts.
    const headingStack = script === "persian" ? stack(heading, latin.heading) : stack(heading)
    const bodyStack = script === "persian" ? stack(body, latin.body) : stack(body)
    return [
      `--site-font-heading:${headingStack}`,
      `--site-font-heading-weight:${heading.weight}`,
      `--site-font-body:${bodyStack}`,
      `--site-font-body-weight:${body.weight}`,
      // Glyph variants of the Latin text font (Inter's); Persian pages keep the fonts' own glyphs.
      `--site-font-features:${script === "persian" ? "normal" : (fontById(latin.body.id)?.features ?? "normal")}`,
    ].join(";")
  }

  return [...faces, `[data-site-theme]{${vars("latin")}}`, `[data-site-theme]:lang(fa){${vars("persian")}}`].join("\n")
}

/** The files to preload for a page in `script`: the main file of its heading and body fonts. */
export function siteFontPreloads(choices: SiteFonts, script: FontScript): string[] {
  const files = new Set<string>()
  for (const part of ["heading", "body"] as const) {
    const font = fontById(choices[script][part].id)
    for (const file of font?.files ?? []) if (file.preload) files.add(file.src)
  }
  return [...files]
}

/** The @font-face family name of a self-hosted font (prefixed, so an installed copy is never used instead). */
function familyName(font: FontDef): string {
  return `"Site ${font.label}"`
}

function stack(...choices: FontChoice[]): string {
  const parts = choices.flatMap((choice) => {
    const font = fontById(choice.id)
    if (!font) return []
    return [font.stack ?? familyName(font)]
  })
  const kind = fontById(choices[0].id)?.kind ?? "sans"
  return [...new Set(parts), kind === "serif" ? "serif" : "ui-sans-serif, system-ui, sans-serif"].join(", ")
}
