import { randomUUID } from "node:crypto"
import { and, desc, eq, gt, inArray } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, auditLog, settings } from "@/db/schema"
import { setSetting, type SettingValue } from "@/lib/settings"
import type { SiteFonts } from "@/themes/fonts"
import { themeDefaultFonts } from "@/themes/ids"
import { getAppearanceSettings } from "./appearance"
import { saveAppearanceSettings } from "./appearance-actions"
import { appearanceSettingsSchema, nearestWeight } from "./appearance-schema"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    appearance: (await import("../../../messages/en/appearance.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
const cache = vi.hoisted(() => ({ refresh: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("next/cache", () => cache)

const session = vi.hoisted(() => ({
  sessionId: "test",
  admin: { id: "", email: "", name: "Appearance Tester", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const KEYS = ["theme", "fonts"] as const
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
const clear = () => db.delete(settings).where(inArray(settings.key, [...KEYS]))

beforeAll(async () => {
  const [admin] = await db
    .insert(admins)
    .values({ email: `appearance-${run}@test.local`, name: "Appearance Tester", passwordHash: "x" })
    .returning()
  Object.assign(session.admin, { id: admin.id, email: admin.email })
  startedAt = new Date(Date.now() - 1000)
})

beforeEach(async () => {
  await clear()
  cache.refresh.mockClear()
})

afterAll(clear)

const atelier = themeDefaultFonts.atelier
/** Atelier with other Latin headings and Vazirmatn for Persian text. */
const custom: SiteFonts = {
  latin: { heading: { id: "lora", weight: 700 }, body: atelier.latin.body },
  persian: { heading: atelier.persian.heading, body: { id: "vazirmatn", weight: 400 } },
}

describe("appearance form schema", () => {
  const parse = (value: unknown) => appearanceSettingsSchema.safeParse(value)
  const issue = (value: unknown) => {
    const result = parse(value)
    return result.success ? null : { path: result.error.issues[0].path.join("."), message: result.error.issues[0].message }
  }

  it("takes every theme with its own fonts", () => {
    for (const [theme, fonts] of Object.entries(themeDefaultFonts)) expect(parse({ theme, fonts }).success, theme).toBe(true)
    expect(parse({ theme: "atelier", fonts: custom }).success).toBe(true)
  })

  it("takes only the registry's themes", () => {
    expect(issue({ theme: "neon", fonts: atelier })).toEqual({ path: "theme", message: "appearance.errors.theme" })
  })

  it("takes only fonts of the row's script", () => {
    const persianForLatin = { ...atelier, latin: { ...atelier.latin, heading: { id: "vazirmatn", weight: 400 } } }
    expect(issue({ theme: "atelier", fonts: persianForLatin })).toEqual({ path: "fonts.latin.heading.id", message: "appearance.errors.font" })
    const latinForPersian = { ...atelier, persian: { ...atelier.persian, body: { id: "inter", weight: 400 } } }
    expect(issue({ theme: "atelier", fonts: latinForPersian })).toEqual({ path: "fonts.persian.body.id", message: "appearance.errors.font" })
    const unknown = { ...atelier, latin: { ...atelier.latin, body: { id: "comic-sans", weight: 400 } } }
    expect(issue({ theme: "atelier", fonts: unknown })?.path).toBe("fonts.latin.body.id")
  })

  it("takes only a weight the font has", () => {
    // Cormorant Garamond goes up to 700, IRANSans has 400, 500 and 700.
    const heavy = { ...atelier, latin: { ...atelier.latin, heading: { id: "cormorant-garamond", weight: 800 } } }
    expect(issue({ theme: "atelier", fonts: heavy })).toEqual({ path: "fonts.latin.heading.weight", message: "appearance.errors.weight" })
    const semibold = { ...atelier, persian: { ...atelier.persian, body: { id: "iransans", weight: 600 } } }
    expect(issue({ theme: "atelier", fonts: semibold })?.path).toBe("fonts.persian.body.weight")
    const fraction = { ...atelier, latin: { ...atelier.latin, body: { id: "montserrat", weight: 450.5 } } }
    expect(issue({ theme: "atelier", fonts: fraction })?.path).toBe("fonts.latin.body.weight")
  })

  it("picks a new font's weight nearest to the old one", () => {
    expect(nearestWeight("montserrat", 500)).toBe(500)
    expect(nearestWeight("cormorant-garamond", 800)).toBe(700)
    expect(nearestWeight("iransans", 600)).toBe(500)
    expect(nearestWeight("lora", 300)).toBe(400)
  })
})

describe("saveAppearanceSettings", () => {
  it("writes the theme and the chosen theme's fonts, each with its own audit entry", async () => {
    expect(await saveAppearanceSettings({ theme: "atelier", fonts: custom })).toEqual({ ok: true, data: { changed: ["theme", "fonts"] } })
    expect(await stored("theme")).toBe("atelier")
    expect(await stored("fonts")).toEqual({ atelier: custom })
    expect(cache.refresh).toHaveBeenCalledOnce()

    const [theme] = await auditsOf("theme")
    expect(theme).toMatchObject({ action: "setting.update", data: { from: "default", to: "atelier" } })
    const [fonts] = await auditsOf("fonts")
    expect(fonts).toMatchObject({ action: "setting.update" })
    expect(fonts.data).toEqual({
      theme: "atelier",
      "latin.heading": { from: "cormorant-garamond 500", to: "lora 700" },
      "persian.body": { from: "iransans 400", to: "vazirmatn 400" },
    })
  })

  it("changes only the chosen theme's fonts and keeps the others'", async () => {
    const classic: SiteFonts = { ...themeDefaultFonts.default, latin: { ...themeDefaultFonts.default.latin, body: { id: "raleway", weight: 400 } } }
    await setSetting("fonts", { default: classic, "old-theme": { latin: classic.latin } })
    await setSetting("theme", "atelier")

    expect(await saveAppearanceSettings({ theme: "atelier", fonts: custom })).toEqual({ ok: true, data: { changed: ["fonts"] } })
    expect(await stored("fonts")).toEqual({ default: classic, "old-theme": { latin: classic.latin }, atelier: custom })
    expect(await auditsOf("theme")).toHaveLength(1) // only the first test's
  })

  it("stores nothing for a theme whose own fonts are chosen, so they keep following the code", async () => {
    await setSetting("theme", "atelier")
    await setSetting("fonts", { atelier: custom, default: themeDefaultFonts.default })

    expect(await saveAppearanceSettings({ theme: "atelier", fonts: atelier })).toEqual({ ok: true, data: { changed: ["fonts"] } })
    // Only the chosen theme's entry goes; the classic one stays, even though it equals its own fonts.
    expect(await stored("fonts")).toEqual({ default: themeDefaultFonts.default })
    const [audit] = await auditsOf("fonts")
    expect(audit.data).toEqual({
      theme: "atelier",
      "latin.heading": { from: "lora 700", to: "cormorant-garamond 500" },
      "persian.body": { from: "vazirmatn 400", to: "iransans 400" },
      themeFonts: true,
    })

    // Saving the classic theme with its own fonts removes its entry in turn.
    expect(await saveAppearanceSettings({ theme: "default", fonts: themeDefaultFonts.default })).toEqual({ ok: true, data: { changed: ["theme", "fonts"] } })
    expect(await stored("fonts")).toEqual({})
  })

  it("writes nothing when nothing changed", async () => {
    await setSetting("theme", "atelier")
    await setSetting("fonts", { atelier: custom })
    const before = { theme: (await auditsOf("theme")).length, fonts: (await auditsOf("fonts")).length }

    expect(await saveAppearanceSettings({ theme: "atelier", fonts: custom })).toEqual({ ok: true, data: { changed: [] } })
    expect(cache.refresh).not.toHaveBeenCalled()
    expect({ theme: (await auditsOf("theme")).length, fonts: (await auditsOf("fonts")).length }).toEqual(before)

    // No row at all is the classic theme with its own fonts.
    await clear()
    expect(await saveAppearanceSettings({ theme: "default", fonts: themeDefaultFonts.default })).toEqual({ ok: true, data: { changed: [] } })
    expect(await stored("theme")).toBeUndefined()
    expect(await stored("fonts")).toBeUndefined()
  })

  it("switches the theme alone when its saved fonts come along", async () => {
    await setSetting("fonts", { atelier: custom })
    expect(await saveAppearanceSettings({ theme: "atelier", fonts: custom })).toEqual({ ok: true, data: { changed: ["theme"] } })
    expect(await stored("theme")).toBe("atelier")
    expect(await stored("fonts")).toEqual({ atelier: custom })
  })

  it("answers with translated field errors and writes nothing", async () => {
    const heavy = { ...atelier, latin: { ...atelier.latin, heading: { id: "cormorant-garamond" as const, weight: 900 } } }
    expect(await saveAppearanceSettings({ theme: "atelier", fonts: heavy })).toMatchObject({
      ok: false,
      fieldErrors: { "fonts.latin.heading.weight": "This font doesn’t come in that weight. Please choose another." },
    })
    expect(await saveAppearanceSettings({ theme: "neon" as never, fonts: atelier })).toMatchObject({
      ok: false,
      fieldErrors: { theme: "Choose one of the templates." },
    })
    expect(await stored("theme")).toBeUndefined()
    expect(await stored("fonts")).toBeUndefined()
  })
})

describe("getAppearanceSettings", () => {
  it("gives the theme, the saved fonts and every theme's fonts", async () => {
    expect(await getAppearanceSettings()).toEqual({ theme: "default", saved: {}, fonts: themeDefaultFonts })

    await setSetting("theme", "atelier")
    await setSetting("fonts", { atelier: custom })
    expect(await getAppearanceSettings()).toEqual({
      theme: "atelier",
      saved: { atelier: custom },
      fonts: { default: themeDefaultFonts.default, atelier: custom },
    })
  })

  it("shows the default theme for an unknown one, and a theme's own fonts for a choice that is not in the registry", async () => {
    await setSetting("theme", "neon")
    // A font removed from the registry, and a weight Cormorant Garamond does not have.
    const stale = {
      latin: { heading: { id: "cormorant-garamond", weight: 900 }, body: atelier.latin.body },
      persian: { heading: { id: "old-font", weight: 400 }, body: { id: "vazirmatn", weight: 300 } },
    }
    await setSetting("fonts", { atelier: stale })
    const result = await getAppearanceSettings()
    expect(result.theme).toBe("default")
    expect(result.fonts.atelier).toEqual(atelier)
  })
})
