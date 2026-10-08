"use server"

import { refresh } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { adminAction } from "@/lib/action"
import { changes } from "@/lib/audit"
import { logoSchema, logoSize } from "@/lib/logo"
import { deleteSetting, getSetting, setSetting, type SettingKey } from "@/lib/settings"
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

/** The audit's short description of a logo: "4468×1478, 1 shape". */
const logoAudit = (logo: z.infer<typeof logoSchema>) => {
  const { width, height } = logoSize(logo)
  return { size: `${Math.round(width)}×${Math.round(height)}`, shapes: logo.paths.length }
}

/**
 * The site's logo, read from an SVG in the browser (logo-svg.ts) and checked
 * here again by `logoSchema`: only numbers and path commands are stored.
 */
export const saveSiteLogo = adminAction(z.object({ logo: logoSchema }), async ({ logo }, ctx) => {
  const before = await getSetting("logo")
  await db.transaction(async (tx) => {
    await setSetting("logo", logo, tx)
    await ctx.audit(settingAudit("logo", { ...logoAudit(logo), ...(before ? { replaced: true } : {}) }), tx)
  })
  refresh()
})

/** No logo: the site shows the brand's name again. */
export const removeSiteLogo = adminAction(z.object({}), async (_, ctx) => {
  const before = await getSetting("logo")
  if (!before) return
  await db.transaction(async (tx) => {
    await deleteSetting("logo", tx)
    await ctx.audit(settingAudit("logo", { removed: true, ...logoAudit(before) }), tx)
  })
  refresh()
})
