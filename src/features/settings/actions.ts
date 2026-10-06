"use server"

import { refresh } from "next/cache"

import { db } from "@/db"
import { adminAction } from "@/lib/action"
import { changes } from "@/lib/audit"
import { getSetting, setSetting, type SettingKey, type SettingValue } from "@/lib/settings"
import { remove, testStorage } from "@/lib/storage"
import { buildCdnConfig, cdnView } from "./cdn"
import { cdnSettingsSchema, generalSettingsSchema, watermarkSettingsSchema } from "./schema"

/** Every change of a setting is one audit entry: "setting.update" with the setting's key as id. */
const settingAudit = (key: SettingKey, data: Record<string, unknown>) =>
  ({ action: "setting.update", entity: "setting", entityId: key, data }) as const

/** Brand, default language, SEO defaults and theme: only the settings that changed are written. */
export const saveGeneralSettings = adminAction(generalSettingsSchema, async (input, ctx) => {
  const keys = ["brand", "defaultLocale", "seo", "theme"] as const
  const before = await Promise.all(keys.map((key) => getSetting(key)))
  const changed = keys.filter((key, i) => Object.keys(changes({ value: before[i] }, { value: input[key] })).length > 0)
  if (changed.length === 0) return { changed }

  await db.transaction(async (tx) => {
    for (const key of changed) {
      const value = input[key] as SettingValue<typeof key>
      await setSetting(key, value, tx)
      await ctx.audit(settingAudit(key, { from: before[keys.indexOf(key)], to: value }), tx)
    }
  })
  refresh() // the brand is in the panel header too
  return { changed }
})

/**
 * Where uploads are stored. New keys are encrypted before they are stored;
 * an empty key field keeps the saved key. The audit entry names the keys
 * that were replaced, never their values.
 */
export const saveStorageSettings = adminAction(cdnSettingsSchema, async (input, ctx) => {
  const current = await getSetting("cdn")
  const { config, replaced } = buildCdnConfig(input, current)
  const before = cdnView(current)
  const after = cdnView(config)
  const diff = changes({ provider: before.provider, ...before.values }, { provider: after.provider, ...after.values })
  if (Object.keys(diff).length === 0 && replaced.length === 0) return { saved: before.saved }

  await db.transaction(async (tx) => {
    await setSetting("cdn", config, tx)
    await ctx.audit(settingAudit("cdn", { ...diff, ...(replaced.length ? { keysReplaced: replaced } : {}) }), tx)
  })
  refresh()
  return { saved: after.saved }
})

/**
 * "Test connection" with the values in the form (not saved yet): writes, reads
 * and deletes a small probe file in both zones. Saves nothing.
 */
export const testStorageSettings = adminAction(cdnSettingsSchema, async (input) => {
  const { config } = buildCdnConfig(input, await getSetting("cdn"))
  return testStorage(config)
})

/** Watermark options. A replaced logo is removed from private storage after saving. */
export const saveWatermarkSettings = adminAction(watermarkSettingsSchema, async (input, ctx) => {
  const before = await getSetting("watermark")
  const diff = changes(before, input)
  if (Object.keys(diff).length === 0) return { changed: false }

  await db.transaction(async (tx) => {
    await setSetting("watermark", input, tx)
    await ctx.audit(settingAudit("watermark", diff), tx)
  })
  if (before.logoPath && before.logoPath !== input.logoPath) {
    await remove(before.logoPath, "private").catch((err) => console.warn("[settings] old watermark logo not removed", err))
  }
  refresh()
  return { changed: true }
})
