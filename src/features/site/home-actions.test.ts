import { randomUUID } from "node:crypto"
import { and, desc, eq, gt } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, auditLog, settings } from "@/db/schema"
import { getSetting, settingDefaults } from "@/lib/settings"
import { saveHomeSettings } from "./home-actions"
import type { HomeSettingsInput } from "./home-schema"
import { getHomeDefaults, getHomeSettings } from "./home-settings"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const load = async (locale: string) => ({
    common: (await import(`../../../messages/${locale}/common.json`)).default,
    homeEditor: (await import(`../../../messages/${locale}/homeEditor.json`)).default,
    home: (await import(`../../../messages/${locale}/home.json`)).default,
  })
  return {
    getTranslations: async (arg?: string | { locale: string; namespace?: string }) => {
      const { locale, namespace } = typeof arg === "object" ? arg : { locale: "en", namespace: arg }
      return createTranslator({ locale, messages: await load(locale), namespace: namespace as never })
    },
    getLocale: async () => "en",
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
const storage = vi.hoisted(() => ({ remove: vi.fn<(path: string) => Promise<void>>(async () => {}) }))
vi.mock("@/lib/storage", async (original) => ({ ...(await original<typeof import("@/lib/storage")>()), remove: storage.remove }))
const auditing = vi.hoisted(() => ({ fail: false }))
vi.mock("@/lib/audit", async (original) => {
  const actual = await original<typeof import("@/lib/audit")>()
  return {
    ...actual,
    audit: async (...args: Parameters<typeof actual.audit>) => {
      if (auditing.fail) throw new Error("audit down")
      return actual.audit(...args)
    },
  }
})

const session = vi.hoisted(() => ({
  sessionId: "test",
  admin: { id: "", email: "", name: "Home Tester", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const run = randomUUID().slice(0, 8)
let startedAt: Date

const file = (name: string, ext = "webp") => `site/${name}-${run}AbC_-123AbC_-12.${ext}`
const [a, b, c, d, clip] = [file("img-a"), file("img-b"), file("img-c"), file("img-d"), file("video-x", "mp4")]
const empty = () => ({ fa: "", tr: "", en: "" })

/** The form's values for an untouched page, changed by `change`. */
function values(change: (v: HomeSettingsInput) => void = () => {}): HomeSettingsInput {
  const v: HomeSettingsInput = {
    hero: { media: "theme", images: [], video: "", poster: "", title: empty(), subtitle: empty(), button: empty() },
    story: { show: true, title: empty(), text: empty(), button: empty(), image: "" },
    crafts: { show: true, title: empty(), image: "" },
    past: { show: true, title: empty() },
    steps: { show: true, title: empty(), items: Array.from({ length: 4 }, () => ({ title: empty(), text: empty() })), image: "" },
    footer: { about: empty(), instagram: "", email: "", phone: "" },
  }
  change(v)
  return v
}

const stored = async () => (await db.select().from(settings).where(eq(settings.key, "home")))[0]?.value
const audits = () =>
  db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, "setting"), eq(auditLog.entityId, "home"), eq(auditLog.adminId, session.admin.id), gt(auditLog.at, startedAt)))
    .orderBy(desc(auditLog.at))

beforeAll(async () => {
  const [admin] = await db.insert(admins).values({ email: `home-${run}@test.local`, name: "Home Tester", passwordHash: "x" }).returning()
  Object.assign(session.admin, { id: admin.id, email: admin.email })
  startedAt = new Date(Date.now() - 1000)
  await db.delete(settings).where(eq(settings.key, "home"))
})
afterAll(async () => {
  await db.delete(settings).where(eq(settings.key, "home"))
})
beforeEach(() => {
  storage.remove.mockClear()
  auditing.fail = false
})

describe("saveHomeSettings", () => {
  it("writes the setting and audits what changed, field by field", async () => {
    const result = await saveHomeSettings(
      values((v) => {
        Object.assign(v.hero, { media: "images", images: [a, b] })
        v.hero.title = { fa: "", tr: "Birlikte üretelim", en: " Let's make " }
        v.story.image = c
        v.past.show = false
        v.footer.instagram = "https://www.instagram.com/limer.tr?igsh=abc"
      }),
    )
    expect(result).toEqual({ ok: true, data: { changed: true } })
    expect(await stored()).toEqual({
      ...settingDefaults.home,
      hero: { ...settingDefaults.home.hero, media: "images", images: [a, b], title: { tr: "Birlikte üretelim", en: "Let's make" } },
      story: { ...settingDefaults.home.story, image: c },
      past: { show: false, title: {} },
      footer: { ...settingDefaults.home.footer, instagram: "https://www.instagram.com/limer.tr" },
    })
    const [entry] = await audits()
    expect(entry).toMatchObject({ action: "setting.update", entity: "setting", entityId: "home" })
    expect(entry.data).toEqual({
      "hero.media": { from: "theme", to: "images" },
      "hero.images": { from: [], to: [a, b] },
      "hero.title": { from: {}, to: { tr: "Birlikte üretelim", en: "Let's make" } },
      "story.image": { from: "", to: c },
      "past.show": { from: true, to: false },
      "footer.instagram": { from: "", to: "https://www.instagram.com/limer.tr" },
    })
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it("writes and audits nothing when nothing changed", async () => {
    const before = await audits()
    const same = values((v) => {
      Object.assign(v.hero, { media: "images", images: [a, b], title: { fa: "", tr: "Birlikte üretelim", en: "Let's make" } })
      v.story.image = c
      v.past.show = false
      v.footer.instagram = "https://www.instagram.com/limer.tr"
    })
    expect(await saveHomeSettings(same)).toEqual({ ok: true, data: { changed: false } })
    expect(await audits()).toHaveLength(before.length)
  })

  it("removes the files no longer used, only after the change is saved", async () => {
    const at: unknown[] = []
    storage.remove.mockImplementation(async () => void at.push(await stored()))
    const next = values((v) => {
      Object.assign(v.hero, { media: "video", images: [b], video: clip, poster: d })
      v.steps.image = a // a photo moved to another section is kept
    })
    expect(await saveHomeSettings(next)).toMatchObject({ ok: true })
    expect(storage.remove.mock.calls.map(([path]) => path).sort()).toEqual([c])
    // When the file was removed, the new value was already saved.
    expect(at).toEqual([expect.objectContaining({ hero: expect.objectContaining({ video: clip, poster: d }) })])

    storage.remove.mockImplementation(async () => {})
    await saveHomeSettings(values())
    expect(storage.remove.mock.calls.map(([path]) => path).sort()).toEqual([a, b, c, clip, d].sort())
  })

  it("keeps the saved value and every file when saving fails", async () => {
    await saveHomeSettings(values((v) => (v.story.image = a)))
    vi.spyOn(console, "error").mockImplementation(() => {})
    auditing.fail = true
    storage.remove.mockClear()
    const result = await saveHomeSettings(values())
    expect(result).toMatchObject({ ok: false })
    expect(await stored()).toMatchObject({ story: expect.objectContaining({ image: a }) })
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it("still saves when an old file cannot be removed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    storage.remove.mockRejectedValueOnce(new Error("CDN down"))
    expect(await saveHomeSettings(values())).toEqual({ ok: true, data: { changed: true } })
    expect(storage.remove).toHaveBeenCalledWith(a)
    expect(warn).toHaveBeenCalled()
    expect(await stored()).toMatchObject({ story: expect.objectContaining({ image: "" }) })
  })

  it("never removes a file outside site/, even one an older value pointed to", async () => {
    const odd = { ...settingDefaults.home, story: { ...settingDefaults.home.story, image: "brand/watermark-logo-x.png" } }
    await db.insert(settings).values({ key: "home", value: odd }).onConflictDoUpdate({ target: settings.key, set: { value: odd } })
    expect(await saveHomeSettings(values())).toEqual({ ok: true, data: { changed: true } })
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it("refuses files that are not the home page's, saving nothing", async () => {
    const before = await stored()
    for (const [change, field] of [
      [(v: HomeSettingsInput) => (v.story.image = "brand/watermark-logo-AbC_-123AbC_-123AbC_-1.png"), "story.image"],
      [(v: HomeSettingsInput) => (v.hero.images = ["workshops/mum/gallery/AbC_-123AbC_-123AbC_-1.webp"]), "hero.images.0"],
      [(v: HomeSettingsInput) => (v.hero.poster = "site/../brand/x.webp"), "hero.poster"],
      [(v: HomeSettingsInput) => (v.hero.video = "site/video-AbC_-123AbC_-123AbC_-1.mov"), "hero.video"],
    ] as const) {
      const result = await saveHomeSettings(values(change))
      expect(result.ok).toBe(false)
      expect(!result.ok && Object.keys(result.fieldErrors ?? {})).toEqual([field])
    }
    const result = await saveHomeSettings(values((v) => (v.crafts.image = "partners/x/photo-AbC_-123AbC_-123AbC_-1.webp")))
    expect(!result.ok && result.fieldErrors).toEqual({ "crafts.image": "Please upload this photo again." })
    expect(await stored()).toEqual(before)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it("explains what is missing for the background chosen", async () => {
    const result = await saveHomeSettings(values((v) => (v.hero.media = "video")))
    expect(!result.ok && result.fieldErrors).toEqual({ "hero.video": "Add a video, or choose another background." })
  })
})

describe("the Home page settings page", () => {
  it("gets the saved value with its files' URLs and the active theme", async () => {
    await saveHomeSettings(values((v) => Object.assign(v.hero, { media: "images", images: [a], video: clip })))
    const page = await getHomeSettings()
    expect(page.saved).toEqual(await getSetting("home"))
    expect(page.urls).toEqual({ [a]: `/media/${a}`, [clip]: `/media/${clip}` })
    expect(typeof page.theme).toBe("string")
  })

  it("gets the theme's own texts in every language, for the placeholders", async () => {
    const defaults = await getHomeDefaults()
    expect(defaults.hero.title).toEqual({
      fa: "با دست‌های خودت چیزی زیبا بساز",
      tr: "Kendi ellerinle güzel bir şey yarat",
      en: "Make something beautiful with your own hands",
    })
    expect(defaults.steps.items).toHaveLength(4)
    expect(defaults.steps.items[3].title.tr).toBe("Gel ve üret")
    expect(defaults.footer.about.fa).toMatch(/ورکشاپ/)
  })
})
