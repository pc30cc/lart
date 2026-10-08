import { type FontScript, isValidChoice, type ScriptFonts, type SiteFonts } from "./fonts"
import { DEFAULT_THEME, isThemeId, themeDefaultFonts } from "./ids"

/** What the `fonts` setting holds for one theme (anything may be missing or out of date). */
export type SavedThemeFonts = { latin?: SavedScriptFonts; persian?: SavedScriptFonts } | undefined
type SavedScriptFonts = { heading: { id: string; weight: number }; body: { id: string; weight: number } }

/**
 * The fonts a theme uses: the saved choice for each script when it is still
 * valid (a known font of that script, in one of its weights), else the theme's
 * own fonts. Safe in the browser (the settings form shows the same result).
 */
export function resolveSiteFonts(themeId: string, saved: SavedThemeFonts): SiteFonts {
  const defaults = themeDefaultFonts[isThemeId(themeId) ? themeId : DEFAULT_THEME]
  const pick = (script: FontScript): ScriptFonts => {
    const choice = saved?.[script]
    if (choice && isValidChoice(choice.heading, script) && isValidChoice(choice.body, script)) {
      return choice as ScriptFonts
    }
    return defaults[script]
  }
  return { latin: pick("latin"), persian: pick("persian") }
}
