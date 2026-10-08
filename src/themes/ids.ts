import type { SiteFonts } from "./fonts"

/**
 * The public site's themes (Settings → Appearance). Pure data, safe in the
 * browser. "default" is the original look (shown as "Classic"); its id stays
 * "default" because that is what saved settings hold.
 */
export const themeIds = ["default", "atelier"] as const
export type ThemeId = (typeof themeIds)[number]

export const DEFAULT_THEME: ThemeId = "default"

export const isThemeId = (value: unknown): value is ThemeId => themeIds.includes(value as ThemeId)

/** Each theme's own fonts, used until an admin picks others for it. */
export const themeDefaultFonts: Record<ThemeId, SiteFonts> = {
  default: {
    latin: { heading: { id: "system-serif", weight: 500 }, body: { id: "inter", weight: 400 } },
    persian: { heading: { id: "iransans", weight: 700 }, body: { id: "iransans", weight: 400 } },
  },
  atelier: {
    latin: { heading: { id: "cormorant-garamond", weight: 500 }, body: { id: "montserrat", weight: 400 } },
    persian: { heading: { id: "noto-naskh-arabic", weight: 700 }, body: { id: "iransans", weight: 400 } },
  },
}
