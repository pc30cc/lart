import { randomUUID } from "node:crypto"
import { and, desc, eq, gt, inArray } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, auditLog, settings } from "@/db/schema"
import { decrypt } from "@/lib/crypto"
import { settingSchemas, type SettingValue } from "@/lib/settings"
import { saveGeneralSettings, saveStorageSettings, saveWatermarkSettings, testStorageSettings } from "./actions"
import { getGeneralSettings, getStorageSettings, getWatermarkSettings } from "./queries"
import { watermarkRange, watermarkSettingsSchema } from "./schema"

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
  remove: vi.fn<(path: string, zone?: string) => Promise<void>>(async () => {}),
}))
vi.mock("@/lib/storage", () => storage)

const session = vi.hoisted(() => ({
  sessionId: "test",
  admin: { id: "", email: "", name: "Settings Tester", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const KEYS = ["brand", "defaultLocale", "seo", "theme", "cdn", "watermark"] as const
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
  storage.testStorage.mockClear()
  storage.remove.mockClear()
})

// Random keys, so nothing can match them by accident.
const PUBLIC_KEY = `pub-${randomUUID()}`
const PRIVATE_KEY = `priv-${randomUUID()}`
const bunny = {
  provider: "bunny" as const,
  storageHost: "storage.bunnycdn.com",
  publicZone: "lart-public",
  publicZoneKey: PUBLIC_KEY,
  publicHost: "cdn.example.com",
  privateZone: "lart-private",
  privateZoneKey: PRIVATE_KEY,
}

describe("storage (CDN) settings", () => {
  it("stores keys encrypted and never sends them, or their ciphertext, back", async () => {
    const result = await saveStorageSettings(bunny)
    expect(result).toEqual({ ok: true, data: { saved: ["publicZoneKey", "privateZoneKey"] } })

    const value = (await stored("cdn")) as Extract<SettingValue<"cdn">, { provider: "bunny" }>
    expect(value.publicZoneKeyEnc).toMatch(/^v1\./)
    expect(value.privateZoneKeyEnc).toMatch(/^v1\./)
    expect(decrypt(value.publicZoneKeyEnc)).toBe(PUBLIC_KEY)
    expect(decrypt(value.privateZoneKeyEnc)).toBe(PRIVATE_KEY)
    expect(JSON.stringify(value)).not.toContain(PUBLIC_KEY)
    expect(JSON.stringify(value)).not.toContain(PRIVATE_KEY)

    const page = await getStorageSettings()
    expect(page).toEqual({
      provider: "bunny",
      values: { storageHost: "storage.bunnycdn.com", publicZone: "lart-public", publicHost: "cdn.example.com", privateZone: "lart-private" },
      saved: ["publicZoneKey", "privateZoneKey"],
    })
    const sent = JSON.stringify([page, result])
    for (const secret of [PUBLIC_KEY, PRIVATE_KEY, value.publicZoneKeyEnc, value.privateZoneKeyEnc]) expect(sent).not.toContain(secret)

    const [audit] = await auditsOf("cdn")
    expect(audit).toMatchObject({ action: "setting.update", data: { provider: { from: "local", to: "bunny" }, keysReplaced: ["publicZoneKey", "privateZoneKey"] } })
  })

  it("keeps a saved key when its field is left empty, and replaces only the one given", async () => {
    const before = (await stored("cdn")) as Extract<SettingValue<"cdn">, { provider: "bunny" }>
    expect(await saveStorageSettings({ ...bunny, publicZoneKey: "", privateZoneKey: "", publicHost: "media.example.com" })).toMatchObject({ ok: true })
    const kept = (await stored("cdn")) as typeof before
    expect(kept.publicZoneKeyEnc).toBe(before.publicZoneKeyEnc)
    expect(kept.privateZoneKeyEnc).toBe(before.privateZoneKeyEnc)
    expect(kept.publicHost).toBe("media.example.com")
    expect((await auditsOf("cdn"))[0].data).toEqual({ publicHost: { from: "cdn.example.com", to: "media.example.com" } })

    const NEW_PRIVATE = `priv-${randomUUID()}`
    await saveStorageSettings({ ...bunny, publicZoneKey: "", privateZoneKey: ` ${NEW_PRIVATE} `, publicHost: "media.example.com" })
    const replaced = (await stored("cdn")) as typeof before
    expect(replaced.publicZoneKeyEnc).toBe(before.publicZoneKeyEnc)
    expect(decrypt(replaced.privateZoneKeyEnc)).toBe(NEW_PRIVATE)
    expect((await auditsOf("cdn"))[0].data).toEqual({ keysReplaced: ["privateZoneKey"] })

    // Saving the same values again changes nothing and writes no audit entry.
    const count = (await auditsOf("cdn")).length
    await saveStorageSettings({ ...bunny, publicZoneKey: "", privateZoneKey: "", publicHost: "media.example.com" })
    expect(await auditsOf("cdn")).toHaveLength(count)
  })

  it("never writes a key or its ciphertext to the audit log", async () => {
    const value = (await stored("cdn")) as Extract<SettingValue<"cdn">, { provider: "bunny" }>
    const log = JSON.stringify(await auditsOf("cdn"))
    for (const secret of [PUBLIC_KEY, PRIVATE_KEY, value.publicZoneKeyEnc, value.privateZoneKeyEnc, decrypt(value.privateZoneKeyEnc)]) {
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
      privateBucket: "lart-private",
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
      privateZone: "lart-public",
    })
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        storageHost: "Please enter a Bunny storage endpoint, like storage.bunnycdn.com.",
        publicHost: "Please enter a hostname, like cdn.example.com (without https://).",
        privateZone: "Private files need their own zone or bucket, different from the public one.",
      },
    })
    for (const host of ["localhost", "127.0.0.1", "10.0.0.1"]) {
      expect(await saveStorageSettings({ ...bunny, publicHost: host })).toMatchObject({ ok: false, fieldErrors: { publicHost: expect.any(String) } })
    }
  })

  it("tests the connection with the values in the form, without saving them", async () => {
    const before = await stored("cdn")
    const NEW_PUBLIC = `pub-${randomUUID()}`
    const result = await testStorageSettings({ ...bunny, publicZone: "lart-other", publicZoneKey: NEW_PUBLIC, privateZoneKey: "" })
    expect(result).toEqual({ ok: true, data: { ok: true } })
    const config = storage.testStorage.mock.calls[0][0] as Extract<SettingValue<"cdn">, { provider: "bunny" }>
    expect(config.publicZone).toBe("lart-other")
    expect(decrypt(config.publicZoneKeyEnc)).toBe(NEW_PUBLIC)
    expect(config.privateZoneKeyEnc).toBe((before as typeof config).privateZoneKeyEnc)
    expect(await stored("cdn")).toEqual(before)
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

  it("saves, audits and removes a replaced logo from private storage", async () => {
    expect(await saveWatermarkSettings({ ...base, logoPath: "brand/2026-10/first_logo-1.png" })).toEqual({ ok: true, data: { changed: true } })
    expect(storage.remove).not.toHaveBeenCalled()
    expect(await getWatermarkSettings()).toMatchObject({ logoUrl: "/api/admin/media/private/brand/2026-10/first_logo-1.png" })

    await saveWatermarkSettings({ ...base, logoPath: "brand/2026-10/second_logo-2.png", position: "tiled", opacity: 0.4 })
    expect(storage.remove).toHaveBeenCalledWith("brand/2026-10/first_logo-1.png", "private")
    expect((await auditsOf("watermark"))[0].data).toEqual({
      logoPath: { from: "brand/2026-10/first_logo-1.png", to: "brand/2026-10/second_logo-2.png" },
      position: { from: "bottom-right", to: "tiled" },
      opacity: { from: 0.7, to: 0.4 },
    })
    expect(await saveWatermarkSettings({ ...base, logoPath: "brand/2026-10/second_logo-2.png", position: "tiled", opacity: 0.4 })).toEqual({
      ok: true,
      data: { changed: false },
    })
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
