import "server-only"

import { getSetting } from "@/lib/settings"
import { atelierTheme } from "./atelier"
import { defaultTheme } from "./default"
import type { SiteFonts } from "./fonts"
import { DEFAULT_THEME, isThemeId, type ThemeId } from "./ids"
import { resolveSiteFonts } from "./resolve-fonts"
import type { Theme } from "./types"

/** Every theme by id. A new theme: its folder, its id in ids.ts, and one line here. */
const themes: Record<ThemeId, Theme> = {
  default: defaultTheme,
  atelier: atelierTheme,
}

/** The theme with this id; any unknown or invalid value gives the default theme. */
export function themeOf(id: unknown): Theme {
  return themes[isThemeId(id) ? id : DEFAULT_THEME]
}

/** The active theme (Settings → Appearance) and its fonts. Cached per request with the settings. */
export async function getActiveTheme(): Promise<{ theme: Theme; fonts: SiteFonts }> {
  const [id, saved] = await Promise.all([getSetting("theme"), getSetting("fonts")])
  const theme = themeOf(id)
  const perTheme = saved && typeof saved === "object" ? (saved as Record<string, unknown>)[theme.id] : undefined
  return { theme, fonts: resolveSiteFonts(theme.id, perTheme as Parameters<typeof resolveSiteFonts>[1]) }
}
