"use server"

import { refresh } from "next/cache"

import { db } from "@/db"
import { adminAction } from "@/lib/action"
import { changes } from "@/lib/audit"
import { getSetting, setSetting, type SettingKey } from "@/lib/settings"
import { fontScripts, type SiteFonts } from "@/themes/fonts"
import { themeDefaultFonts } from "@/themes/ids"
import { resolveSiteFonts } from "@/themes/resolve-fonts"
import { appearanceSettingsSchema } from "./appearance-schema"

/** Every change of a setting is one audit entry: "setting.update" with the setting's key as id. */
const settingAudit = (key: SettingKey, data: Record<string, unknown>) =>
  ({ action: "setting.update", entity: "setting", entityId: key, data }) as const

const same = (a: unknown, b: unknown) => Object.keys(changes({ value: a }, { value: b })).length === 0

/** The four choices as short texts for the audit entry: { "latin.heading": "cormorant-garamond 500", … }. */
const flat = (fonts: SiteFonts) =>
  Object.fromEntries(
    fontScripts.flatMap((script) =>
      (["heading", "body"] as const).map((part) => [`${script}.${part}`, `${fonts[script][part].id} ${fonts[script][part].weight}`]),
    ),
  )

/**
 * The site's theme and the chosen theme's fonts. The fonts are kept per theme:
 * only the chosen theme's entry changes, and fonts equal to the theme's own are
 * not stored, so they keep following the code. Only the settings that changed
 * are written, each with its own audit entry.
 */
export const saveAppearanceSettings = adminAction(appearanceSettingsSchema, async (input, ctx) => {
  const [theme, saved] = await Promise.all([getSetting("theme"), getSetting("fonts")])
  const { [input.theme]: before, ...others } = saved
  const ownFonts = same(input.fonts, themeDefaultFonts[input.theme])
  const fonts = ownFonts ? others : { ...others, [input.theme]: input.fonts }

  const changed: SettingKey[] = []
  if (theme !== input.theme) changed.push("theme")
  if (!same(saved, fonts)) changed.push("fonts")
  if (changed.length === 0) return { changed }

  await db.transaction(async (tx) => {
    if (changed.includes("theme")) {
      await setSetting("theme", input.theme, tx)
      await ctx.audit(settingAudit("theme", { from: theme, to: input.theme }), tx)
    }
    if (changed.includes("fonts")) {
      await setSetting("fonts", fonts, tx)
      const diff = changes(flat(resolveSiteFonts(input.theme, before)), flat(input.fonts))
      await ctx.audit(settingAudit("fonts", { theme: input.theme, ...diff, ...(ownFonts ? { themeFonts: true } : {}) }), tx)
    }
  })
  refresh()
  return { changed }
})
