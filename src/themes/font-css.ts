import { type FontChoice, type FontDef, fontById, fonts, type FontScript, type SiteFonts } from "./fonts"

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

  const styles = siteFontStyles(choices)
  const vars = (script: FontScript) => {
    const s = styles[script]
    return [
      `--site-font-heading:${s.heading.family}`,
      `--site-font-heading-weight:${s.heading.weight}`,
      `--site-font-body:${s.body.family}`,
      `--site-font-body-weight:${s.body.weight}`,
      `--site-font-features:${s.features}`,
    ].join(";")
  }

  return [
    ...[...used.values()].flatMap(fontFaces),
    `[data-site-theme]{${vars("latin")}}`,
    `[data-site-theme]:lang(fa){${vars("persian")}}`,
  ].join("\n")
}

/** A font as the site's styles get it: its font-family list and weight. */
export type FontStyle = { family: string; weight: number }

/**
 * The font-family lists, weights and glyph variants the site's styles get for
 * each script: what `siteFontCss` writes into its variables, and what the
 * Appearance settings' preview shows.
 */
export function siteFontStyles(choices: SiteFonts): Record<FontScript, { heading: FontStyle; body: FontStyle; features: string }> {
  const latin = choices.latin
  const persian = choices.persian
  return {
    latin: {
      heading: { family: stack(latin.heading), weight: weightOf(latin.heading) },
      body: { family: stack(latin.body), weight: weightOf(latin.body) },
      // Glyph variants of the Latin text font (Inter's).
      features: fontById(latin.body.id)?.features ?? "normal",
    },
    persian: {
      // A Persian page also shows Latin words (venues, names): they fall back to the Latin fonts.
      heading: { family: stack(persian.heading, latin.heading), weight: weightOf(persian.heading) },
      body: { family: stack(persian.body, latin.body), weight: weightOf(persian.body) },
      // Persian pages keep the fonts' own glyphs.
      features: "normal",
    },
  }
}

/**
 * @font-face rules for every self-hosted font of the registry, with the same
 * family names as on the site. Only the Appearance settings page uses it, so
 * its preview can show any font; a browser downloads a file only when the
 * page uses that font.
 */
export function fontPoolCss(): string {
  return fonts.flatMap(fontFaces).join("\n")
}

/** One font's font-family list with its fallback (an unknown id gives only the fallback). */
export function fontStack(id: string): string {
  return stack({ id: id as FontChoice["id"], weight: 400 })
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

/** The @font-face rules of a self-hosted font (none for a font named by its `stack`). */
function fontFaces(font: FontDef): string[] {
  return font.files.map(
    (file) =>
      `@font-face{font-family:${familyName(font)};font-style:normal;font-display:swap;font-weight:${font.weightRange};src:url(${file.src}) format("woff2");unicode-range:${file.range}}`,
  )
}

/** The @font-face family name of a self-hosted font (prefixed, so an installed copy is never used instead). */
function familyName(font: FontDef): string {
  return `"Site ${font.label}"`
}

/** The choice's weight when the font has it, else a plain 400 (never a value from outside the registry). */
function weightOf(choice: FontChoice): number {
  const weights: readonly number[] = fontById(choice.id)?.weights ?? []
  return weights.includes(choice.weight) ? choice.weight : 400
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
