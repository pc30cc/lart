import "server-only"

import { requireAdmin } from "@/lib/auth/admin"
import { getSetting, type SettingValue } from "@/lib/settings"
import type { SiteFonts } from "@/themes/fonts"
import { DEFAULT_THEME, isThemeId, themeIds, type ThemeId } from "@/themes/ids"
import { resolveSiteFonts } from "@/themes/resolve-fonts"

export type AppearanceSettings = {
  /** The site's theme (a saved id that is not a theme any more shows the default theme, as on the site). */
  theme: ThemeId
  /** The `fonts` setting as saved: the fonts an admin chose, per theme. */
  saved: SettingValue<"fonts">
  /** The fonts each theme uses: the saved choice when it is still valid, else the theme's own. */
  fonts: Record<ThemeId, SiteFonts>
}

/** Settings → Appearance: the theme and the fonts of every theme. */
export async function getAppearanceSettings(): Promise<AppearanceSettings> {
  await requireAdmin()
  const [theme, saved] = await Promise.all([getSetting("theme"), getSetting("fonts")])
  return {
    theme: isThemeId(theme) ? theme : DEFAULT_THEME,
    saved,
    fonts: Object.fromEntries(themeIds.map((id) => [id, resolveSiteFonts(id, saved[id])])) as Record<ThemeId, SiteFonts>,
  }
}
