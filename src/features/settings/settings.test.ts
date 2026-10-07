import { randomUUID } from "node:crypto"
import { and, desc, eq, gt, inArray } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, auditLog, settings } from "@/db/schema"
import { decrypt, encrypt } from "@/lib/crypto"
import { getSetting, settingSchemas, type SettingValue } from "@/lib/settings"
import { getStorage } from "@/lib/storage"
import {
  saveEmailSettings,
  saveGeneralSettings,
  saveStorageSettings,
  saveWatermarkSettings,
  testEmailSettings,
  testStorageSettings,
} from "./actions"
import { getEmailSettings, getGeneralSettings, getStorageSettings, getWatermarkSettings } from "./queries"
import { type EmailSettingsInput, watermarkRange, watermarkSettingsSchema } from "./schema"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    settings: (await import("../../../messages/en/settings.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
const storage = vi.hoisted(() => ({
  testStorage: vi.fn<(config: unknown) => Promise<{ ok: true }>>(async () => ({ ok: true })),
  remove: vi.fn<(path: string) => Promise<void>>(async () => {}),
}))
vi.mock("@/lib/storage", async (original) => ({ ...(await original<typeof import("@/lib/storage")>()), ...storage }))
const mail = vi.hoisted(() => ({ deliver: vi.fn() }))
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/email")>()), deliver: mail.deliver }))

const session = vi.hoisted(() => ({
  sessionId: "test",
  admin: { id: "", email: "", name: "Settings Tester", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const KEYS = ["brand", "defaultLocale", "seo", "theme", "cdn", "watermark", "email"] as const
const run = randomUUID().slice(0, 8)
let startedAt: Date

const stored = async <K extends (typeof KEYS)[number]>(key: K) =>
  (await db.select().from(settings).where(eq(settings.key, key)))[0]?.value as SettingValue<K> | undefined
const auditsOf = (key: string) =>
  db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, "setting"), eq(auditLog.entityId, key), eq(auditLog.adminId, session.admin.id), gt(auditLog.at, startedAt)))
    .orderBy(desc(auditLog.at))

beforeAll(async () => {
  const [admin] = await db
    .insert(admins)
    .values({ email: `settings-${run}@test.local`, name: "Settings Tester", passwordHash: "x" })
    .returning()
  Object.assign(session.admin, { id: admin.id, email: admin.email })
  startedAt = new Date(Date.now() - 1000)
  await db.delete(settings).where(inArray(settings.key, [...KEYS]))
})

afterAll(async () => {
  await db.delete(settings).where(inArray(settings.key, [...KEYS]))
})

beforeEach(() => {
  mail.deliver.mockReset()
  storage.testStorage.mockClear()
  storage.remove.mockClear()
})

// Random keys, so nothing can match them by accident.
const PUBLIC_KEY = `pub-${randomUUID()}`
const bunny = {
  provider: "bunny" as const,
  storageHost: "storage.bunnycdn.com",
  publicZone: "lart-public",
  publicZoneKey: PUBLIC_KEY,
  publicHost: "cdn.example.com",
}
type BunnySetting = Extract<SettingValue<"cdn">, { provider: "bunny" }>

describe("storage (CDN) settings", () => {
  it("stores the key encrypted and never sends it, or its ciphertext, back", async () => {
    const result = await saveStorageSettings(bunny)
    expect(result).toEqual({ ok: true, data: { saved: ["publicZoneKey"] } })

    const value = (await stored("cdn")) as BunnySetting
    expect(value.publicZoneKeyEnc).toMatch(/^v1\./)
    expect(decrypt(value.publicZoneKeyEnc)).toBe(PUBLIC_KEY)
    expect(JSON.stringify(value)).not.toContain(PUBLIC_KEY)

    const page = await getStorageSettings()
    expect(page).toEqual({
      provider: "bunny",
      values: { storageHost: "storage.bunnycdn.com", publicZone: "lart-public", publicHost: "cdn.example.com" },
      saved: ["publicZoneKey"],
    })
    const sent = JSON.stringify([page, result])
    for (const secret of [PUBLIC_KEY, value.publicZoneKeyEnc]) expect(sent).not.toContain(secret)

    const [audit] = await auditsOf("cdn")
    expect(audit).toMatchObject({ action: "setting.update", data: { provider: { from: "local", to: "bunny" }, keysReplaced: ["publicZoneKey"] } })
  })

  it("keeps the saved key when its field is left empty, and replaces it when one is given", async () => {
    const before = (await stored("cdn")) as BunnySetting
    expect(await saveStorageSettings({ ...bunny, publicZoneKey: "", publicHost: "media.example.com" })).toMatchObject({ ok: true })
    const kept = (await stored("cdn")) as BunnySetting
    expect(kept.publicZoneKeyEnc).toBe(before.publicZoneKeyEnc)
    expect(kept.publicHost).toBe("media.example.com")
    expect((await auditsOf("cdn"))[0].data).toEqual({ publicHost: { from: "cdn.example.com", to: "media.example.com" } })

    const NEW_KEY = `pub-${randomUUID()}`
    await saveStorageSettings({ ...bunny, publicZoneKey: ` ${NEW_KEY} `, publicHost: "media.example.com" })
    const replaced = (await stored("cdn")) as BunnySetting
    expect(decrypt(replaced.publicZoneKeyEnc)).toBe(NEW_KEY)
    expect((await auditsOf("cdn"))[0].data).toEqual({ keysReplaced: ["publicZoneKey"] })

    // Saving the same values again changes nothing and writes no audit entry.
    const count = (await auditsOf("cdn")).length
    await saveStorageSettings({ ...bunny, publicZoneKey: "", publicHost: "media.example.com" })
    expect(await auditsOf("cdn")).toHaveLength(count)
  })

  it("never writes a key or its ciphertext to the audit log", async () => {
    const value = (await stored("cdn")) as BunnySetting
    const log = JSON.stringify(await auditsOf("cdn"))
    for (const secret of [PUBLIC_KEY, value.publicZoneKeyEnc, decrypt(value.publicZoneKeyEnc)]) {
      expect(log).not.toContain(secret)
    }
  })

  it("asks for the keys when switching provider, and keeps the saved setting", async () => {
    const before = await stored("cdn")
    const result = await saveStorageSettings({
      provider: "cloudflare",
      accountId: "0123456789abcdef0123456789abcdef",
      accessKeyId: "",
      secretAccessKey: "",
      publicBucket: "lart-public",
      publicHost: "cdn.example.com",
    })
    const message = "Please paste the key. It’s stored encrypted and never shown again."
    expect(result).toEqual({ ok: false, error: message, fieldErrors: { accessKeyId: message } })
    expect(await stored("cdn")).toEqual(before)
  })

  it("validates hosts and names before anything is stored", async () => {
    const result = await saveStorageSettings({
      ...bunny,
      storageHost: "evil.example.com",
      publicHost: "https://cdn.example.com",
      publicZone: "Lart Public",
    })
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        storageHost: "Please choose the region of your storage zone.",
        publicHost: "Please enter a hostname, like cdn.example.com (without https://).",
        publicZone: "Use lowercase letters, numbers and hyphens only.",
      },
    })
    for (const host of ["localhost", "127.0.0.1", "10.0.0.1"]) {
      expect(await saveStorageSettings({ ...bunny, publicHost: host })).toMatchObject({ ok: false, fieldErrors: { publicHost: expect.any(String) } })
    }
  })

  it("tests the connection with the values in the form, without saving them", async () => {
    const before = await stored("cdn")
    const NEW_PUBLIC = `pub-${randomUUID()}`
    const result = await testStorageSettings({ ...bunny, publicZone: "lart-other", publicZoneKey: NEW_PUBLIC })
    expect(result).toEqual({ ok: true, data: { ok: true } })
    const config = storage.testStorage.mock.calls[0][0] as BunnySetting
    expect(config.publicZone).toBe("lart-other")
    expect(decrypt(config.publicZoneKeyEnc)).toBe(NEW_PUBLIC)
    expect(await testStorageSettings({ ...bunny, publicZoneKey: "" })).toEqual({ ok: true, data: { ok: true } })
    expect((storage.testStorage.mock.calls[1][0] as BunnySetting).publicZoneKeyEnc).toBe((before as BunnySetting).publicZoneKeyEnc)
    expect(await stored("cdn")).toEqual(before)
  })

  it("keeps working with a setting saved when there was a private zone too, without entering anything again", async () => {
    // The production row from before: the private zone's fields are simply no longer read.
    const OLD_KEY = `pub-${randomUUID()}`
    const PRIVATE_KEY = `priv-${randomUUID()}`
    const old = {
      provider: "bunny",
      storageHost: "storage.bunnycdn.com",
      publicZone: "lart-public",
      publicZoneKeyEnc: encrypt(OLD_KEY),
      publicHost: "cdn.example.com",
      privateZone: "lart-private",
      privateZoneKeyEnc: encrypt(PRIVATE_KEY),
    }
    await db.insert(settings).values({ key: "cdn", value: old }).onConflictDoUpdate({ target: settings.key, set: { value: old } })

    const { privateZone, privateZoneKeyEnc, ...kept } = old
    expect(await getSetting("cdn")).toEqual(kept)
    expect((await getStorage()).publicUrl("workshops/mum/cover-a.webp")).toBe("https://cdn.example.com/workshops/mum/cover-a.webp")
    const page = await getStorageSettings()
    expect(page).toEqual({
      provider: "bunny",
      values: { storageHost: "storage.bunnycdn.com", publicZone: "lart-public", publicHost: "cdn.example.com" },
      saved: ["publicZoneKey"],
    })
    expect(JSON.stringify(page)).not.toContain(privateZone)

    // The form as the page shows it (key field empty): testing and saving use the saved key.
    const form = { ...bunny, ...page.values, publicZoneKey: "" }
    expect(await testStorageSettings(form)).toEqual({ ok: true, data: { ok: true } })
    expect(storage.testStorage.mock.calls.at(-1)?.[0]).toEqual(kept)
    expect(await saveStorageSettings(form)).toEqual({ ok: true, data: { saved: ["publicZoneKey"] } })
    expect(await saveStorageSettings({ ...form, publicHost: "media.example.com" })).toMatchObject({ ok: true })
    const value = (await stored("cdn")) as BunnySetting
    expect(value).toEqual({ ...kept, publicHost: "media.example.com" })
    expect(decrypt(value.publicZoneKeyEnc)).toBe(OLD_KEY)
    expect(JSON.stringify(await auditsOf("cdn"))).not.toContain(privateZoneKeyEnc)
  })

  it("goes back to local storage", async () => {
    expect(await saveStorageSettings({ provider: "local" })).toEqual({ ok: true, data: { saved: [] } })
    expect(await stored("cdn")).toEqual({ provider: "local" })
    expect(await getStorageSettings()).toEqual({ provider: "local", values: {}, saved: [] })
  })
})

describe("general settings", () => {
  const input = {
    brand: { fa: "لارت", tr: `Lart ${run}`, en: `Lart ${run}` },
    defaultLocale: "fa" as const,
    seo: { title: { tr: "Atölyeler", en: "", fa: "" }, description: { fa: "", tr: "", en: "" } },
    theme: "default" as const,
  }

  it("writes only the settings that changed, each with its own audit entry", async () => {
    const result = await saveGeneralSettings(input)
    expect(result).toEqual({ ok: true, data: { changed: ["brand", "defaultLocale", "seo"] } })
    expect(await stored("brand")).toEqual(input.brand)
    expect(await stored("seo")).toEqual({ title: { tr: "Atölyeler" }, description: {} })
    expect(await stored("theme")).toBeUndefined() // unchanged default: nothing written
    expect((await auditsOf("defaultLocale"))[0]).toMatchObject({ action: "setting.update", data: { from: "tr", to: "fa" } })
    expect(await getGeneralSettings()).toMatchObject({ brand: input.brand, defaultLocale: "fa", theme: "default" })

    expect(await saveGeneralSettings(input)).toEqual({ ok: true, data: { changed: [] } })
    expect(await auditsOf("brand")).toHaveLength(1)
  })

  it("needs the brand name in all three languages and a known theme and language", async () => {
    const result = await saveGeneralSettings({ ...input, brand: { fa: "", tr: "Lart", en: "Lart" }, theme: "neon" as never, defaultLocale: "de" as never })
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { "brand.fa": "Please fill this in.", theme: expect.any(String), defaultLocale: expect.any(String) },
    })
  })
})

describe("watermark settings", () => {
  const base = { logoPath: null, position: "bottom-right" as const, sizePct: 18, opacity: 0.7, marginPct: 3 }

  it("saves, audits and removes a replaced logo from storage", async () => {
    // A logo uploaded before the named folders (brand/<yyyy-mm>/…) still saves.
    expect(await saveWatermarkSettings({ ...base, logoPath: "brand/2026-10/first_logo-1.png" })).toEqual({ ok: true, data: { changed: true } })
    expect(storage.remove).not.toHaveBeenCalled()
    expect(await getWatermarkSettings()).toMatchObject({ logoUrl: "/media/brand/2026-10/first_logo-1.png" })

    const second = "brand/watermark-logo-AbC_-123AbC_-123AbC_-1.png"
    await saveWatermarkSettings({ ...base, logoPath: second, position: "tiled", opacity: 0.4 })
    expect(storage.remove).toHaveBeenCalledExactlyOnceWith("brand/2026-10/first_logo-1.png")
    expect((await auditsOf("watermark"))[0].data).toEqual({
      logoPath: { from: "brand/2026-10/first_logo-1.png", to: second },
      position: { from: "bottom-right", to: "tiled" },
      opacity: { from: 0.7, to: 0.4 },
    })
    expect(await saveWatermarkSettings({ ...base, logoPath: second, position: "tiled", opacity: 0.4 })).toEqual({
      ok: true,
      data: { changed: false },
    })
  })

  it("shows no logo URL instead of failing when the storage setting cannot be used", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const broken = { provider: "bunny", storageHost: "storage.bunnycdn.com", publicZone: "x", publicZoneKeyEnc: "v1.bad", publicHost: "cdn.example.com" }
    await db.insert(settings).values({ key: "cdn", value: broken }).onConflictDoUpdate({ target: settings.key, set: { value: broken } })
    try {
      expect(await getWatermarkSettings()).toMatchObject({ logoPath: expect.any(String), logoUrl: null })
    } finally {
      await db.delete(settings).where(eq(settings.key, "cdn"))
    }
  })

  it("accepts only a logo uploaded for the watermark", async () => {
    for (const logoPath of ["originals/2026-10/photo.webp", "brand/2026-10/logo.webp", "../brand/x.png", "brand/../../etc/passwd.png"]) {
      expect(await saveWatermarkSettings({ ...base, logoPath })).toMatchObject({ ok: false, fieldErrors: { logoPath: "Please upload the logo again." } })
    }
  })

  it("uses the same ranges as the stored setting", () => {
    const stored = settingSchemas.watermark
    for (const [field, { min, max }] of Object.entries(watermarkRange)) {
      for (const [value, ok] of [[min, true], [max, true], [min - 0.01, false], [max + 0.01, false]] as const) {
        const candidate = { ...base, [field]: value }
        expect(watermarkSettingsSchema.safeParse(candidate).success).toBe(ok)
        expect(stored.safeParse(candidate).success).toBe(ok)
      }
    }
  })
})

describe("email settings", () => {
  const RESEND_KEY = `re_${randomUUID().replaceAll("-", "")}`
  const SMTP_PASSWORD = `pw-${randomUUID()}`
  const resend: EmailSettingsInput = {
    provider: "resend",
    fromAddress: " Hello@Limer.tr ",
    replyTo: "",
    resendKey: RESEND_KEY,
    smtpHost: "",
    smtpPort: 587,
    smtpSecurity: "starttls",
    smtpUser: "",
    smtpPassword: "",
  }
  const smtp: EmailSettingsInput = {
    ...resend,
    provider: "smtp",
    resendKey: "",
    smtpHost: "Mail.Limer.tr",
    smtpUser: "hello@limer.tr",
    smtpPassword: SMTP_PASSWORD,
  }

  it("stores the key and password encrypted, never sends them back, and never audits them", async () => {
    expect(await saveEmailSettings(resend)).toEqual({ ok: true, data: { saved: { resendKey: true, smtpPassword: false } } })
    expect(await saveEmailSettings(smtp)).toEqual({ ok: true, data: { saved: { resendKey: true, smtpPassword: true } } })
    const value = (await stored("email"))!
    expect(value).toMatchObject({ provider: "smtp", fromAddress: "hello@limer.tr", smtp: { host: "mail.limer.tr", user: "hello@limer.tr" } })
    expect(decrypt(value.resendKeyEnc)).toBe(RESEND_KEY)
    expect(decrypt(value.smtp.passwordEnc)).toBe(SMTP_PASSWORD)

    const view = JSON.stringify(await getEmailSettings())
    const audits = JSON.stringify(await auditsOf("email"))
    for (const text of [view, audits]) {
      expect(text).not.toContain(RESEND_KEY)
      expect(text).not.toContain(SMTP_PASSWORD)
      expect(text).not.toContain(value.resendKeyEnc)
    }
    expect(audits).toContain("keysReplaced")
  })

  it("keeps a saved key or password when its field is left empty, and switching back loses nothing", async () => {
    const tls = { ...smtp, smtpPassword: "", smtpPort: 465, smtpSecurity: "tls" as const }
    await saveEmailSettings(tls)
    // The form always sends both providers' fields, so switching keeps the other's.
    await saveEmailSettings({ ...tls, provider: "resend" })
    const value = (await stored("email"))!
    expect(value.provider).toBe("resend")
    expect(decrypt(value.resendKeyEnc)).toBe(RESEND_KEY)
    expect(value.smtp).toMatchObject({ port: 465, security: "tls" })
    expect(decrypt(value.smtp.passwordEnc)).toBe(SMTP_PASSWORD)
  })

  it("asks for what is missing in friendly words", async () => {
    await db.delete(settings).where(eq(settings.key, "email"))
    expect(await saveEmailSettings({ ...resend, resendKey: "" })).toMatchObject({ ok: false, fieldErrors: { resendKey: "Enter the API key." } })
    expect(await saveEmailSettings({ ...smtp, smtpPassword: "" })).toMatchObject({ ok: false, fieldErrors: { smtpPassword: "Enter the password." } })
    expect(await saveEmailSettings({ ...smtp, smtpHost: "" })).toMatchObject({ ok: false, fieldErrors: { smtpHost: expect.any(String) } })
    expect(await saveEmailSettings({ ...resend, resendKey: "sk_live_123456789" })).toMatchObject({
      ok: false,
      fieldErrors: { resendKey: "A Resend API key starts with re_." },
    })
    expect(await saveEmailSettings({ ...resend, fromAddress: "not an address" })).toMatchObject({ ok: false })
    expect(await stored("email")).toBeUndefined()
  })

  it("a server without sign-in needs no password", async () => {
    expect(await saveEmailSettings({ ...smtp, smtpHost: "relay", smtpPort: 25, smtpSecurity: "none", smtpUser: "", smtpPassword: "" })).toMatchObject({
      ok: true,
    })
    expect((await stored("email"))!.smtp).toMatchObject({ host: "relay", user: "", passwordEnc: "" })
  })

  it("sends a test email to the signed-in admin with the form's values, without saving them", async () => {
    await saveEmailSettings(resend)
    mail.deliver.mockResolvedValue({ ok: true, id: "t1" })
    expect(await testEmailSettings({ ...smtp, smtpHost: "smtp.other.example" })).toEqual({ ok: true, data: { to: session.admin.email } })
    const [transport, message] = mail.deliver.mock.calls[0]
    expect(transport).toEqual({ kind: "smtp", host: "smtp.other.example", port: 587, security: "starttls", user: "hello@limer.tr", password: SMTP_PASSWORD })
    expect(message).toMatchObject({ to: session.admin.email, from: expect.stringContaining("<hello@limer.tr>") })
    expect((await stored("email"))!.provider).toBe("resend")

    mail.deliver.mockResolvedValue({ ok: false, error: "SMTP: Invalid login: 535 Authentication failed" })
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await testEmailSettings(smtp)).toEqual({
      ok: false,
      error: "The test email couldn’t be sent: SMTP: Invalid login: 535 Authentication failed",
    })
  })
})
