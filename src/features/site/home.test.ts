import { beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkshopCard } from "@/features/registrations/public"
import type { SettingValue } from "@/lib/settings"
import type { PastWorkshop, PublicCategory } from "@/themes/types"
import { getHomeData } from "./home"

// Outside a Next.js request: the real messages of each language, and per test
// the saved settings, the open workshops, the categories and past workshops.
const messages = vi.hoisted(async () => ({
  fa: {
    home: (await import("../../../messages/fa/home.json")).default,
    site: (await import("../../../messages/fa/site.json")).default,
    registration: (await import("../../../messages/fa/registration.json")).default,
  },
  tr: {
    home: (await import("../../../messages/tr/home.json")).default,
    site: (await import("../../../messages/tr/site.json")).default,
    registration: (await import("../../../messages/tr/registration.json")).default,
  },
  en: {
    home: (await import("../../../messages/en/home.json")).default,
    site: (await import("../../../messages/en/site.json")).default,
    registration: (await import("../../../messages/en/registration.json")).default,
  },
}))
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const all = await messages
  return {
    getTranslations: async ({ locale, namespace }: { locale: "fa" | "tr" | "en"; namespace: string }) =>
      createTranslator({ locale, messages: all[locale], namespace: namespace as never }),
  }
})

const state = vi.hoisted(() => ({
  saved: {} as Record<string, unknown>,
  workshops: [] as WorkshopCard[],
  categories: [] as PublicCategory[],
  past: [] as PastWorkshop[],
}))
vi.mock("@/lib/settings", async (importOriginal) => {
  const { settingDefaults } = await importOriginal<typeof import("@/lib/settings")>()
  return {
    getBrand: async (locale: string) => (locale === "fa" ? "لیمر" : "Limer"),
    getSetting: async (key: keyof typeof settingDefaults) => state.saved[key] ?? settingDefaults[key],
  }
})
vi.mock("@/features/registrations/public", () => ({
  listOpenWorkshops: vi.fn(async (_locale: string, { limit = 120 }: { limit?: number } = {}) => state.workshops.slice(0, limit)),
}))
vi.mock("./public", () => ({
  listPublicCategories: vi.fn(async () => state.categories),
  listPastWorkshops: vi.fn(async () => state.past),
}))
// A file's address on the CDN; "missing" plays a file that cannot be linked.
vi.mock("@/lib/storage", () => ({
  publicUrls: async () => (path: string | null | undefined) =>
    path && !path.includes("missing") ? `https://cdn.test/${path}` : null,
}))

const { listOpenWorkshops } = vi.mocked(await import("@/features/registrations/public"))
const { listPastWorkshops } = vi.mocked(await import("./public"))
const all = await messages

type Home = SettingValue<"home">
/** The `home` setting as saved by the editor: the defaults with these parts changed. */
function saveHome(parts: { [K in keyof Home]?: Partial<Home[K]> }) {
  const base: Home = {
    hero: { media: "theme", images: [], video: "", poster: "", title: {}, subtitle: {}, button: {} },
    story: { show: true, title: {}, text: {}, button: {}, image: "" },
    crafts: { show: true, title: {}, image: "" },
    past: { show: true, title: {} },
    steps: { show: true, title: {}, items: [], image: "" },
    footer: { about: {}, instagram: "", email: "", phone: "" },
  }
  state.saved.home = Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, { ...v, ...(parts[k as keyof Home] ?? {}) }]),
  ) as Home
}

const card = (n: number): WorkshopCard => {
  const startsAt = new Date(Date.now() + (n + 1) * 86_400_000)
  return {
    id: `w${n}`,
    slug: `workshop-${n}`,
    title: `Workshop ${n}`,
    venue: "Moda",
    category: "Candles",
    categorySlug: "candles",
    instructorName: "Zeynep",
    coverUrl: null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 7_200_000),
    registrationDeadline: startsAt,
    price: 150_000,
    maxCapacity: 10,
    seatsLeft: 4,
    ageMin: null,
    ageMax: null,
    window: "open",
  }
}
const candles: PublicCategory = { slug: "candles", name: "Candles", count: 2 }
const pastOne: PastWorkshop = { slug: "old", title: "Old one", startsAt: new Date("2026-05-01T10:00:00Z"), coverUrl: null, photos: [] }

beforeEach(() => {
  state.saved = {}
  state.workshops = []
  state.categories = [candles]
  state.past = []
  vi.clearAllMocks()
})

describe("getHomeData", () => {
  it.each(["fa", "tr", "en"] as const)("uses the bundled texts of %s where nothing is saved", async (locale) => {
    const m = all[locale]
    const data = await getHomeData(locale)
    expect(data).toMatchObject({
      locale,
      brand: locale === "fa" ? "لیمر" : "Limer",
      tagline: m.site.home.tagline,
      hero: { media: { kind: "theme" }, title: m.home.hero.title, subtitle: m.home.hero.subtitle, button: m.home.hero.button },
      story: { title: m.home.story.title, text: m.home.story.text, button: m.home.story.button, imageUrl: null },
      crafts: { title: m.home.crafts.title, imageUrl: null },
      steps: {
        title: m.home.steps.title,
        items: [m.home.steps.step1, m.home.steps.step2, m.home.steps.step3, m.home.steps.step4],
        imageUrl: null,
      },
      labels: {
        upcomingTitle: m.site.home.upcomingTitle,
        allWorkshops: m.site.home.allWorkshops,
        seeAllWorkshops: m.site.home.cta,
        emptyTitle: m.registration.list.emptyTitle,
        emptyText: m.registration.list.emptyText,
      },
    })
    expect(data.categories).toEqual([candles])
  })

  it("uses the admin's texts where they are written in the page's language", async () => {
    state.saved.seo = { title: {}, description: { tr: "İstanbul'da sanat atölyeleri." } }
    saveHome({
      hero: { title: { tr: "Birlikte üretelim", fa: "  " }, subtitle: { en: "Small, warm workshops." } },
      story: { title: { fa: "داستان ما" }, text: { fa: "متن" }, button: { tr: "Takvim" }, image: "site/story.webp" },
      crafts: { title: { en: "Crafts" }, image: "site/crafts.webp" },
      past: { title: { tr: "Önceki atölyeler" } },
      steps: { title: { en: "Four steps" }, image: "site/steps.webp" },
    })
    state.past = [pastOne]

    const tr = await getHomeData("tr")
    expect(tr.tagline).toBe("İstanbul'da sanat atölyeleri.")
    expect(tr.hero).toMatchObject({ title: "Birlikte üretelim", subtitle: all.tr.home.hero.subtitle })
    expect(tr.story).toMatchObject({ title: all.tr.home.story.title, button: "Takvim", imageUrl: "https://cdn.test/site/story.webp" })
    expect(tr.past).toEqual({ title: "Önceki atölyeler", workshops: [pastOne] })

    // Another language's text never shows: Persian falls back to its own bundled texts (a blank title too).
    const fa = await getHomeData("fa")
    expect(fa.tagline).toBe(all.fa.site.home.tagline)
    expect(fa.hero.title).toBe(all.fa.home.hero.title)
    expect(fa.story).toMatchObject({ title: "داستان ما", text: "متن", button: all.fa.home.story.button })
    expect(fa.past?.title).toBe(all.fa.home.past.title)

    const en = await getHomeData("en")
    expect(en.hero.subtitle).toBe("Small, warm workshops.")
    expect(en.crafts).toEqual({ title: "Crafts", imageUrl: "https://cdn.test/site/crafts.webp" })
    expect(en.steps).toMatchObject({ title: "Four steps", imageUrl: "https://cdn.test/site/steps.webp" })
  })

  it("gives null for the sections the admin hid, and does not read past workshops then", async () => {
    state.past = [pastOne]
    saveHome({ story: { show: false }, crafts: { show: false }, past: { show: false }, steps: { show: false } })
    const data = await getHomeData("en")
    expect(data).toMatchObject({ story: null, crafts: null, past: null, steps: null })
    expect(listPastWorkshops).not.toHaveBeenCalled()
  })

  it("gives null for a section with nothing to show: no categories, no past workshops", async () => {
    state.categories = []
    state.past = []
    const data = await getHomeData("en")
    expect(data.crafts).toBeNull()
    expect(data.past).toBeNull()
    expect(data.story).not.toBeNull()

    state.categories = [candles]
    state.past = [pastOne]
    const shown = await getHomeData("en")
    expect(shown.crafts).not.toBeNull()
    expect(shown.past).toEqual({ title: all.en.home.past.title, workshops: [pastOne] })
    expect(listPastWorkshops).toHaveBeenCalledWith("en")
  })

  describe("hero media", () => {
    it("photos in turn, leaving out the ones that cannot be linked", async () => {
      saveHome({ hero: { media: "images", images: ["site/a.webp", "site/missing.webp", "site/b.webp"] } })
      expect((await getHomeData("en")).hero.media).toEqual({
        kind: "images",
        images: ["https://cdn.test/site/a.webp", "https://cdn.test/site/b.webp"],
      })
    })

    it("a video with its poster, or without one", async () => {
      saveHome({ hero: { media: "video", video: "site/hero.mp4", poster: "site/poster.webp" } })
      expect((await getHomeData("en")).hero.media).toEqual({
        kind: "video",
        url: "https://cdn.test/site/hero.mp4",
        posterUrl: "https://cdn.test/site/poster.webp",
      })
      saveHome({ hero: { media: "video", video: "site/hero.mp4", poster: "" } })
      expect((await getHomeData("en")).hero.media).toEqual({ kind: "video", url: "https://cdn.test/site/hero.mp4", posterUrl: null })
      saveHome({ hero: { media: "video", video: "site/hero.mp4", poster: "site/missing.webp" } })
      expect((await getHomeData("en")).hero.media).toEqual({ kind: "video", url: "https://cdn.test/site/hero.mp4", posterUrl: null })
    })

    it("the theme's own photos when the chosen files are missing", async () => {
      for (const hero of [
        { media: "images" as const, images: [] },
        { media: "images" as const, images: ["site/missing-1.webp", "site/missing-2.webp"] },
        { media: "video" as const, video: "", poster: "site/poster.webp" },
        { media: "video" as const, video: "site/missing.mp4" },
        { media: "theme" as const, images: ["site/a.webp"], video: "site/hero.mp4" },
      ]) {
        saveHome({ hero })
        expect((await getHomeData("en")).hero.media, JSON.stringify(hero)).toEqual({ kind: "theme" })
      }
    })
  })

  it("steps: the four bundled ones, or the admin's own, each empty field from the bundled step at its place", async () => {
    saveHome({
      steps: {
        items: [
          { title: { en: "Pick one" }, text: { en: "Any you like." } },
          { title: { en: "Book" }, text: { tr: "Sadece Türkçe" } },
          { title: {}, text: { en: "Then come." } },
        ],
      },
    })
    const steps = all.en.home.steps
    expect((await getHomeData("en")).steps?.items).toEqual([
      { title: "Pick one", text: "Any you like." },
      { title: "Book", text: steps.step2.text },
      { title: steps.step3.title, text: "Then come." },
    ])
    // In Turkish only the Turkish text is the admin's.
    const tr = all.tr.home.steps
    expect((await getHomeData("tr")).steps?.items).toEqual([
      { title: tr.step1.title, text: tr.step1.text },
      { title: tr.step2.title, text: "Sadece Türkçe" },
      { title: tr.step3.title, text: tr.step3.text },
    ])
  })

  it("asks for the next eight open workshops at most, soonest first", async () => {
    state.workshops = Array.from({ length: 12 }, (_, i) => card(i))
    const data = await getHomeData("en")
    expect(listOpenWorkshops).toHaveBeenCalledWith("en", { limit: 8 })
    expect(data.upcoming.map((w) => w.id)).toEqual(["w0", "w1", "w2", "w3", "w4", "w5", "w6", "w7"])

    state.workshops = []
    expect((await getHomeData("en")).upcoming).toEqual([])
  })
})
