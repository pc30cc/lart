import { randomUUID } from "node:crypto"
import { and, desc, eq, gt } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, auditLog, settings } from "@/db/schema"
import { getSetting, settingDefaults } from "@/lib/settings"
import { saveHomeSettings } from "./home-actions"
import type { HomeSettingsInput } from "./home-schema"
import { getHomeDefaults, getHomeSettings, readHome } from "./home-settings"

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
// Every file is in storage, except the ones in `gone`.
const storage = vi.hoisted(() => {
  const gone = new Set<string>()
  return {
    gone,
    remove: vi.fn<(path: string) => Promise<void>>(async () => {}),
    exists: vi.fn<(path: string) => Promise<boolean>>(async (path) => !gone.has(path)),
  }
})
vi.mock("@/lib/storage", async (original) => ({
  ...(await original<typeof import("@/lib/storage")>()),
  remove: storage.remove,
  exists: storage.exists,
}))
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
    aboutPage: { text: empty() },
  }
  change(v)
  return v
}

/** The saved page's version, as the settings page gives it to the form. */
const version = async () => (await readHome()).version
/** Save from a page opened just now. */
const save = async (change?: (v: HomeSettingsInput) => void) => saveHomeSettings({ ...values(change), version: await version() })
const saved = (changed: boolean) => ({ ok: true, data: { changed, version: expect.stringMatching(/^\d+$/) } })
const pageChanged =
  "This page was saved again after you opened it (in another tab or by another admin). Please reload the page and make your changes again."

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
  storage.remove.mockImplementation(async () => {})
  storage.exists.mockClear()
  storage.gone.clear()
  auditing.fail = false
})

describe("saveHomeSettings", () => {
  it("writes the setting and audits what changed, field by field", async () => {
    expect(await version()).toBe("") // never saved
    const result = await save((v) => {
      Object.assign(v.hero, { media: "images", images: [a, b] })
      v.hero.title = { fa: "", tr: "Birlikte üretelim", en: " Let's make " }
      v.story.image = c
      v.past.show = false
      v.footer.instagram = "https://www.instagram.com/limer.tr?igsh=abc"
    })
    expect(result).toEqual(saved(true))
    expect(result.ok && result.data.version).toBe(await version())
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
    expect(storage.exists.mock.calls.map(([path]) => path).sort()).toEqual([a, b, c])
  })

  it("writes and audits nothing when nothing changed, even from a page opened before the last save", async () => {
    const before = await audits()
    const current = await version()
    const same = values((v) => {
      Object.assign(v.hero, { media: "images", images: [a, b], title: { fa: "", tr: "Birlikte üretelim", en: "Let's make" } })
      v.story.image = c
      v.past.show = false
      v.footer.instagram = "https://www.instagram.com/limer.tr"
    })
    // The page is up to date: it gets the current version.
    for (const opened of [current, "", "1"]) {
      expect(await saveHomeSettings({ ...same, version: opened })).toEqual({ ok: true, data: { changed: false, version: current } })
    }
    expect(await audits()).toHaveLength(before.length)
    expect(await version()).toBe(current)
  })

  it("gives the new version, with which the same page saves again", async () => {
    const first = await save((v) => (v.footer.email = "hello@limer.test"))
    expect(first).toEqual(saved(true))
    const next = first.ok ? first.data.version : ""
    expect(next).toBe(await version())
    const again = await saveHomeSettings({ ...values((v) => (v.footer.email = "hi@limer.test")), version: next })
    expect(again).toEqual(saved(true))
    expect(again.ok && again.data.version).not.toBe(next)
    expect(await stored()).toMatchObject({ footer: expect.objectContaining({ email: "hi@limer.test" }) })
  })

  it("refuses a save from a page opened before another save, keeping that save and its photo", async () => {
    await save((v) => (v.story.image = a))
    // Two tabs open the page, with photo a; removing a file takes it out of storage.
    const opened = await version()
    storage.remove.mockImplementation(async (path) => void storage.gone.add(path))
    // The first tab replaces the photo with b: a is removed.
    expect(await saveHomeSettings({ ...values((v) => (v.story.image = b)), version: opened })).toEqual(saved(true))
    expect(storage.remove.mock.calls).toEqual([[a]])
    // The second tab still shows a, and changes only the footer.
    const late = values((v) => {
      v.story.image = a
      v.footer.phone = "+90 555 123 45 67"
    })
    for (const stale of [opened, ""]) {
      expect(await saveHomeSettings({ ...late, version: stale })).toEqual({ ok: false, error: pageChanged })
    }
    expect(await stored()).toMatchObject({ story: expect.objectContaining({ image: b }), footer: expect.objectContaining({ phone: "" }) })
    expect(storage.remove.mock.calls).toEqual([[a]]) // b is kept
  })

  it("refuses a new photo or video no longer in storage, on its field; files already saved are not checked", async () => {
    await save((v) => (v.story.image = a))
    storage.remove.mockClear()
    storage.exists.mockClear()
    storage.gone.add(a).add(c).add(clip) // a, the saved photo, too: not this page's to fix
    const before = await stored()
    for (const [change, field, message] of [
      [(v: HomeSettingsInput) => (v.crafts.image = c), "crafts.image", "Please upload this photo again."],
      [(v: HomeSettingsInput) => Object.assign(v.hero, { media: "images", images: [b, c] }), "hero.images.1", "Please upload this photo again."],
      [(v: HomeSettingsInput) => Object.assign(v.hero, { media: "video", video: clip }), "hero.video", "Please upload the video again."],
    ] as const) {
      const result = await save((v) => {
        v.story.image = a
        change(v)
      })
      expect(result).toEqual({ ok: false, error: message, fieldErrors: { [field]: message } })
    }
    expect(await stored()).toEqual(before)
    expect(storage.exists).not.toHaveBeenCalledWith(a)

    expect(
      await save((v) => {
        v.story.image = a
        v.crafts.image = b
      }),
    ).toEqual(saved(true))
    expect(storage.exists).toHaveBeenLastCalledWith(b)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it("removes the files no longer used, only after the change is saved", async () => {
    const at: unknown[] = []
    await save((v) => {
      Object.assign(v.hero, { media: "images", images: [a, b] })
      v.story.image = c
    })
    storage.remove.mockClear()
    storage.remove.mockImplementation(async () => void at.push(await stored()))
    expect(
      await save((v) => {
        Object.assign(v.hero, { media: "video", images: [b], video: clip, poster: d })
        v.steps.image = a // a photo moved to another section is kept
      }),
    ).toMatchObject({ ok: true })
    expect(storage.remove.mock.calls.map(([path]) => path).sort()).toEqual([c])
    // When the file was removed, the new value was already saved.
    expect(at).toEqual([expect.objectContaining({ hero: expect.objectContaining({ video: clip, poster: d }) })])

    storage.remove.mockImplementation(async () => {})
    await save()
    expect(storage.remove.mock.calls.map(([path]) => path).sort()).toEqual([a, b, c, clip, d].sort())
  })

  it("keeps the saved value and every file when saving fails", async () => {
    await save((v) => (v.story.image = a))
    const opened = await version()
    vi.spyOn(console, "error").mockImplementation(() => {})
    auditing.fail = true
    storage.remove.mockClear()
    const result = await save()
    expect(result).toMatchObject({ ok: false })
    expect(await stored()).toMatchObject({ story: expect.objectContaining({ image: a }) })
    expect(await version()).toBe(opened)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it("still saves when an old file cannot be removed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    storage.remove.mockRejectedValueOnce(new Error("CDN down"))
    expect(await save()).toEqual(saved(true))
    expect(storage.remove).toHaveBeenCalledWith(a)
    expect(warn).toHaveBeenCalled()
    expect(await stored()).toMatchObject({ story: expect.objectContaining({ image: "" }) })
  })

  it("never removes a file outside site/, even one an older value pointed to", async () => {
    const odd = { ...settingDefaults.home, story: { ...settingDefaults.home.story, image: "brand/watermark-logo-x.png" } }
    await db.insert(settings).values({ key: "home", value: odd }).onConflictDoUpdate({ target: settings.key, set: { value: odd } })
    expect(await save()).toEqual(saved(true))
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
      const result = await save(change)
      expect(result.ok).toBe(false)
      expect(!result.ok && Object.keys(result.fieldErrors ?? {})).toEqual([field])
    }
    const result = await save((v) => (v.crafts.image = "partners/x/photo-AbC_-123AbC_-123AbC_-1.webp"))
    expect(!result.ok && result.fieldErrors).toEqual({ "crafts.image": "Please upload this photo again." })
    expect(await stored()).toEqual(before)
    expect(storage.remove).not.toHaveBeenCalled()
    expect(storage.exists).not.toHaveBeenCalled()
  })

  it("explains what is missing for the background chosen", async () => {
    const result = await save((v) => (v.hero.media = "video"))
    expect(!result.ok && result.fieldErrors).toEqual({ "hero.video": "Add a video, or choose another background." })
  })
})

describe("the Home page settings page", () => {
  it("gets the saved value and its version with its files' URLs and the active theme", async () => {
    const result = await save((v) => Object.assign(v.hero, { media: "images", images: [a], video: clip }))
    const page = await getHomeSettings()
    expect(page.saved).toEqual(await getSetting("home"))
    expect(page.version).toBe(result.ok && result.data.version)
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
