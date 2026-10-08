import { defaultTheme } from "../default"
import { themeDefaultFonts } from "../ids"
import type { Theme } from "../types"

/**
 * Atelier: the premium theme after the owner's earlier site (throttlehaus.ca).
 * Placeholder until its own components land: the classic frame and sections.
 */
export const atelierTheme: Theme = {
  ...defaultTheme,
  id: "atelier",
  themeColor: { light: "#F2E9E5", dark: "#24160F" },
  fonts: themeDefaultFonts.atelier,
}
