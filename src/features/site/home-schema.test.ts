import { describe, expect, it } from "vitest"

import { settingDefaults, settingSchemas } from "@/lib/settings"
import { homeFiles, homeSettingsSchema, isSiteImagePath, isSiteVideoPath, type HomeSettingsInput } from "./home-schema"

const id = "AbC_-123AbC_-123AbC_-1"
const photo = (n = 1) => `site/img-${id.slice(0, 21)}${n}.webp`
const video = `site/video-${id}.mp4`
const empty = () => ({ fa: "", tr: "", en: "" })

/** The form's values for an untouched page. */
const blank = (): HomeSettingsInput => ({
  hero: { media: "theme", images: [], video: "", poster: "", title: empty(), subtitle: empty(), button: empty() },
  story: { show: true, title: empty(), text: empty(), button: empty(), image: "" },
  crafts: { show: true, title: empty(), image: "" },
  past: { show: true, title: empty() },
  steps: { show: true, title: empty(), items: Array.from({ length: 4 }, () => ({ title: empty(), text: empty() })), image: "" },
  footer: { about: empty(), instagram: "", email: "", phone: "" },
  aboutPage: { text: empty() },
})

const parse = (change: (v: HomeSettingsInput) => void) => {
  const value = blank()
  change(value)
  return homeSettingsSchema.safeParse(value)
}
const errorsOf = (change: (v: HomeSettingsInput) => void) => {
  const result = parse(change)
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]))
}

describe("homeSettingsSchema", () => {
  it("gives the stored default for an untouched page (four empty steps are the theme's steps)", () => {
    const result = homeSettingsSchema.parse(blank())
    expect(result).toEqual(settingDefaults.home)
  })

  it("keeps steps the admin wrote, and empty ones among them", () => {
    const result = parse((v) => {
      v.steps.items = [{ title: { ...empty(), tr: "Seç" }, text: empty() }, { title: empty(), text: empty() }, { title: empty(), text: empty() }]
    })
    expect(result.success && result.data.steps.items).toEqual([{ title: { tr: "Seç" }, text: {} }, { title: {}, text: {} }, { title: {}, text: {} }])
    expect(errorsOf((v) => v.steps.items.push({ title: empty(), text: empty() }))).toHaveProperty("steps.items")
  })

  it("uses the stored setting's text limits", () => {
    const at = (n: number) => "a".repeat(n)
    for (const [set, max] of [
      [(v: HomeSettingsInput, s: string) => (v.hero.title.tr = s), 500],
      [(v: HomeSettingsInput, s: string) => (v.steps.items[0].text.fa = s), 500],
      [(v: HomeSettingsInput, s: string) => (v.story.text.en = s), 1500],
      [(v: HomeSettingsInput, s: string) => (v.footer.about.tr = s), 1500],
    ] as const) {
      const ok = parse((v) => set(v, at(max)))
      expect(ok.success).toBe(true)
      expect(settingSchemas.home.safeParse(ok.success && ok.data).success).toBe(true)
      expect(parse((v) => set(v, at(max + 1))).success).toBe(false)
    }
  })

  it("takes only the home page's own files", () => {
    expect([isSiteImagePath(photo()), isSiteVideoPath(video), isSiteVideoPath(`site/video-${id}.webm`)]).toEqual([true, true, true])
    for (const path of [
      `brand/watermark-logo-${id}.png`,
      `workshops/mum/cover-${id}.webp`,
      `workshops/mum/gallery/${id}.webp`,
      `site/../brand/${id}.webp`,
      `/site/img-${id}.webp`,
      `site/img-${id}.png`,
      video,
      "https://evil.example/site/img.webp",
    ]) {
      expect(errorsOf((v) => (v.story.image = path)), path).toEqual({ "story.image": "homeEditor.errors.photo" })
    }
    for (const path of [photo(), `site/video-${id}.mov`, `workshops/mum/videos/${id}.mp4`]) {
      expect(errorsOf((v) => (v.hero.video = path)), path).toEqual({ "hero.video": "homeEditor.errors.video" })
    }
    expect(errorsOf((v) => (v.hero.images = [photo(1), `partners/mina/photo-${id}.webp`]))).toEqual({ "hero.images.1": "homeEditor.errors.photo" })
  })

  it("takes up to six different photos for the hero", () => {
    expect(parse((v) => (v.hero.images = [1, 2, 3, 4, 5, 6].map(photo))).success).toBe(true)
    expect(parse((v) => (v.hero.images = [1, 2, 3, 4, 5, 6, 7].map(photo))).success).toBe(false)
    expect(parse((v) => (v.hero.images = [photo(1), photo(1)])).success).toBe(false)
  })

  it("needs something to show for the background chosen", () => {
    expect(errorsOf((v) => (v.hero.media = "images"))).toEqual({ "hero.images": "homeEditor.errors.photosNeeded" })
    expect(errorsOf((v) => (v.hero.media = "video"))).toEqual({ "hero.video": "homeEditor.errors.videoNeeded" })
    // The other background's files are kept, so switching back needs no new upload.
    const kept = parse((v) => Object.assign(v.hero, { media: "theme", images: [photo()], video }))
    expect(kept.success && kept.data.hero).toMatchObject({ media: "theme", images: [photo()], video })
  })

  it.each([
    ["https://instagram.com/limer.tr", "https://instagram.com/limer.tr"],
    [" https://www.instagram.com/limer_tr/ ", "https://www.instagram.com/limer_tr/"],
    ["https://www.instagram.com/limer.tr?igsh=MXd2a3VhdWs=", "https://www.instagram.com/limer.tr"],
    ["", ""],
  ])("takes the Instagram address %j", (input, stored) => {
    const result = parse((v) => (v.footer.instagram = input))
    expect(result.success && result.data.footer.instagram).toBe(stored)
  })

  it.each([
    "http://instagram.com/limer",
    "instagram.com/limer",
    "@limer",
    "https://instagram.com.evil.example/limer",
    "https://evil.example/instagram.com/limer",
    "javascript:alert(1)//instagram.com/x",
    "https://instagram.com/limer/../x",
    "https://instagram.com/",
  ])("refuses the Instagram address %j", (input) => {
    expect(errorsOf((v) => (v.footer.instagram = input))).toEqual({ "footer.instagram": "homeEditor.errors.instagram" })
  })

  it("takes an email address or nothing", () => {
    const result = parse((v) => (v.footer.email = " Hello@Limer.tr "))
    expect(result.success && result.data.footer.email).toBe("hello@limer.tr")
    expect(errorsOf((v) => (v.footer.email = "hello@"))).toEqual({ "footer.email": "common.validation.email" })
  })

  it.each([
    ["+90 555 123 45 67", "+90 555 123 45 67"],
    ["۰۵۵۵ ۱۲۳ ۴۵ ۶۷", "0555 123 45 67"],
    ["(0212) 555-12-34", "0212 555 12 34"],
    ["", ""],
  ])("takes the phone number %j as %j", (input, stored) => {
    const result = parse((v) => (v.footer.phone = input))
    expect(result.success && result.data.footer.phone).toBe(stored)
  })

  it.each(["call us", "12345", "+90 555 abc", "90+555123", "1".repeat(21)])("refuses the phone number %j", (input) => {
    expect(errorsOf((v) => (v.footer.phone = input))).toEqual({ "footer.phone": "homeEditor.errors.phone" })
  })

  it("lists every file a value uses", () => {
    const home = { ...settingDefaults.home }
    home.hero = { ...home.hero, images: [photo(1), photo(2)], video, poster: photo(3) }
    home.story = { ...home.story, image: photo(4) }
    expect(homeFiles(home)).toEqual([photo(1), photo(2), video, photo(3), photo(4)])
    expect(homeFiles(settingDefaults.home)).toEqual([])
  })
})
