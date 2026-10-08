/**
 * The Appearance settings form (theme and fonts), shared by the form (client)
 * and the action (server). Only the registry's themes and fonts pass
 * (src/themes/ids.ts, src/themes/fonts.ts), each font in one of its own weights;
 * the stored schema (lib/settings.ts) checks the value again when it is written.
 */
import { z } from "zod"

import { fontById, type FontId, fonts, type FontScript, isValidChoice } from "@/themes/fonts"
import { themeIds } from "@/themes/ids"

/** The ids of one script's fonts, for its selects and its schema. */
export const scriptFontIds = (script: FontScript) => fonts.filter((f) => f.script === script).map((f) => f.id) as [FontId, ...FontId[]]

/** A font of `script` and one of that font's weights. */
const fontChoice = (script: FontScript) =>
  z
    .object({
      id: z.enum(scriptFontIds(script), { error: "appearance.errors.font" }),
      weight: z.number().int(),
    })
    .refine((choice) => isValidChoice(choice, script), { path: ["weight"], error: "appearance.errors.weight" })

const scriptFonts = (script: FontScript) => z.object({ heading: fontChoice(script), body: fontChoice(script) })

export const appearanceSettingsSchema = z.object({
  theme: z.enum(themeIds, { error: "appearance.errors.theme" }),
  /** The chosen theme's fonts: Latin (Turkish, English) and Persian, heading and text. */
  fonts: z.object({ latin: scriptFonts("latin"), persian: scriptFonts("persian") }),
})

export type AppearanceSettingsValues = z.input<typeof appearanceSettingsSchema>

/** The weight of `fontId` nearest to `weight` (a new font keeps the old one's weight when it has it). */
export function nearestWeight(fontId: string, weight: number): number {
  const weights: readonly number[] = fontById(fontId)?.weights ?? [400]
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0])
}
