"use server"

import { refresh } from "next/cache"
import { getTranslations } from "next-intl/server"

import { db } from "@/db"
import { setMainLocale } from "@/i18n/main-locale"
import { adminAction, UserError } from "@/lib/action"
import { changes } from "@/lib/audit"
import { deliver, emailConfig, sender } from "@/lib/email"
import { errorForLog } from "@/lib/errors"
import { getBrand, getSetting, setSetting, type SettingKey, type SettingValue } from "@/lib/settings"
import { remove, testStorage } from "@/lib/storage"
import { buildCdnConfig, cdnView } from "./cdn"
import { buildEmailSetting, emailView } from "./email"
import { cdnSettingsSchema, emailSettingsSchema, generalSettingsSchema, watermarkSettingsSchema } from "./schema"

/** Every change of a setting is one audit entry: "setting.update" with the setting's key as id. */
const settingAudit = (key: SettingKey, data: Record<string, unknown>) =>
  ({ action: "setting.update", entity: "setting", entityId: key, data }) as const

/**
 * Brand, main language and SEO defaults: only the settings that changed are
 * written. (The theme is on the Appearance page: appearance-actions.ts.)
 */
export const saveGeneralSettings = adminAction(generalSettingsSchema, async (input, ctx) => {
  const keys = ["brand", "defaultLocale", "seo"] as const
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
  // The addresses follow the main language: at once in this process, within
  // the cache time (30 s) in the others.
  if (changed.includes("defaultLocale")) setMainLocale(input.defaultLocale)
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
 * (also through the CDN) and deletes a small probe file. Saves nothing.
 */
export const testStorageSettings = adminAction(cdnSettingsSchema, async (input) => {
  const { config } = buildCdnConfig(input, await getSetting("cdn"))
  return testStorage(config)
})

/** Watermark options. A replaced logo is removed from storage after saving. */
export const saveWatermarkSettings = adminAction(watermarkSettingsSchema, async (input, ctx) => {
  const before = await getSetting("watermark")
  const diff = changes(before, input)
  if (Object.keys(diff).length === 0) return { changed: false }

  await db.transaction(async (tx) => {
    await setSetting("watermark", input, tx)
    await ctx.audit(settingAudit("watermark", diff), tx)
  })
  if (before.logoPath && before.logoPath !== input.logoPath) {
    await remove(before.logoPath).catch((err) => console.warn("[settings] old watermark logo not removed", errorForLog(err)))
  }
  refresh()
  return { changed: true }
})

/**
 * How emails are sent: Resend or an SMTP server, the sender and reply-to
 * addresses. A new key or password is encrypted; an empty one keeps the saved
 * one. The audit entry names the secrets that were replaced, never their values.
 */
export const saveEmailSettings = adminAction(emailSettingsSchema, async (input, ctx) => {
  const current = await getSetting("email")
  const { setting, replaced } = buildEmailSetting(input, current)
  const before = emailView(current)
  const after = emailView(setting)
  const plain = (v: typeof before) => ({ provider: v.provider, fromAddress: v.fromAddress, replyTo: v.replyTo, smtp: v.smtp })
  const diff = changes(plain(before), plain(after))
  if (Object.keys(diff).length === 0 && replaced.length === 0 && before.saved.smtpPassword === after.saved.smtpPassword) {
    return { saved: before.saved }
  }

  await db.transaction(async (tx) => {
    await setSetting("email", setting, tx)
    await ctx.audit(settingAudit("email", { ...diff, ...(replaced.length ? { keysReplaced: replaced } : {}) }), tx)
  })
  return { saved: after.saved }
})

/**
 * "Send a test email" with the values in the form (not saved yet), to the
 * signed-in admin's own address. The provider's answer is shown to the admin
 * when it fails (wrong password, unknown host, domain not verified...).
 */
export const testEmailSettings = adminAction(emailSettingsSchema, async (input, ctx) => {
  const { setting } = buildEmailSetting(input, await getSetting("email"))
  const config = emailConfig(setting)
  if (!config.transport) throw new UserError("settings.email.errors.keyRequired", { field: "resendKey" })
  const locale = await getSetting("defaultLocale")
  const [t, brand] = await Promise.all([getTranslations({ locale, namespace: "settings.email.testEmail" }), getBrand(locale)])
  const from = sender(config.fromAddress, brand)
  if (!from) throw new UserError("common.validation.email", { field: "fromAddress" })

  const text = t("text", { brand, provider: config.transport.kind === "smtp" ? "SMTP" : "Resend" })
  const result = await deliver(config.transport, {
    from,
    to: ctx.admin.email,
    subject: t("subject", { brand }),
    text,
    html: `<p style="font-family:sans-serif;font-size:15px">${text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</p>`,
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
  })
  if (!result.ok) {
    console.warn("[settings] test email failed", result.error)
    throw new UserError("settings.email.test.failed", { values: { error: result.error.slice(0, 300) } })
  }
  return { to: ctx.admin.email }
})
