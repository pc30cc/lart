/**
 * The Home page settings form (Settings → Home page), shared by the form
 * (client) and `saveHomeSettings` (server). As strict as, or stricter than,
 * the stored `home` setting in lib/settings.ts, which is checked again when it
 * is written. Empty texts and photos mean "use the template's own".
 */
import { z } from "zod"

import { localizedText } from "@/components/admin/form/schemas"
import type { Locale } from "@/db/schema"
import { normalizeDigits } from "@/lib/format"
import { isSafePath } from "@/lib/storage/shared"

/** Same limits as the stored setting: short texts, the paragraphs, photos in the hero, steps. */
export const HOME_TEXT_MAX = 500
export const HOME_LONG_TEXT_MAX = 1500
export const HERO_IMAGES_MAX = 6
export const HOME_STEPS_MAX = 4

/** The hero's background: the template's photos, the admin's photos in turn, or a video. */
export const heroMediaChoices = ["theme", "images", "video"] as const
export type HeroMediaChoice = (typeof heroMediaChoices)[number]

const inSite = (extensions: readonly string[]) => (path: string) =>
  isSafePath(path) && path.startsWith("site/") && extensions.includes(path.slice(path.lastIndexOf(".") + 1))

/** A photo uploaded for the home page (purpose `site_image`: `site/img-<random>.webp`). */
export const isSiteImagePath = inSite(["webp"])
/** The home page's video (purpose `site_video`: `site/video-<random>.mp4` or `.webm`). */
export const isSiteVideoPath = inSite(["mp4", "webm"])

const text = () => localizedText({ max: HOME_TEXT_MAX })
const longText = () => localizedText({ max: HOME_LONG_TEXT_MAX })
const photo = z.string().refine(isSiteImagePath, { error: "homeEditor.errors.photo" })
/** One photo, or "" for none. */
const optionalPhoto = z.string().refine((v) => v === "" || isSiteImagePath(v), { error: "homeEditor.errors.photo" })

const isEmail = (v: string) => z.email().safeParse(v).success
const INSTAGRAM = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?$/
/** Digits, spaces and a leading +: 6 to 20 digits, at most 40 characters (the stored limit). */
function isPhone(v: string) {
  const digits = v.replace(/\D/g, "").length
  return /^\+?[0-9 ]+$/.test(v) && v.length <= 40 && digits >= 6 && digits <= 20
}

const isEmpty = (step: { title: Partial<Record<Locale, string>>; text: Partial<Record<Locale, string>> }) =>
  Object.keys(step.title).length === 0 && Object.keys(step.text).length === 0

export const homeSettingsSchema = z
  .object({
    hero: z.object({
      media: z.enum(heroMediaChoices),
      images: z
        .array(photo)
        .max(HERO_IMAGES_MAX)
        .refine((paths) => new Set(paths).size === paths.length, { error: "homeEditor.errors.photo" }),
      video: z.string().refine((v) => v === "" || isSiteVideoPath(v), { error: "homeEditor.errors.video" }),
      poster: optionalPhoto,
      title: text(),
      subtitle: text(),
      button: text(),
    }),
    story: z.object({ show: z.boolean(), title: text(), text: longText(), button: text(), image: optionalPhoto }),
    crafts: z.object({ show: z.boolean(), title: text(), image: optionalPhoto }),
    past: z.object({ show: z.boolean(), title: text() }),
    steps: z.object({
      show: z.boolean(),
      title: text(),
      // Four empty steps are the template's four steps: stored as none.
      items: z
        .array(z.object({ title: text(), text: text() }))
        .max(HOME_STEPS_MAX)
        .transform((items) => (items.length === HOME_STEPS_MAX && items.every(isEmpty) ? [] : items)),
      image: optionalPhoto,
    }),
    footer: z.object({
      about: longText(),
      // A link copied from the app ends with "?igsh=…": that part is left out.
      instagram: z
        .string()
        .trim()
        .transform((v) => v.replace(/[?#].*$/, ""))
        .refine((v) => v === "" || INSTAGRAM.test(v), { error: "homeEditor.errors.instagram" }),
      email: z
        .string()
        .trim()
        .toLowerCase()
        .max(254)
        .refine((v) => v === "" || isEmail(v), { error: "common.validation.email" }),
      // Persian digits become Latin ones; dashes, dots and brackets become spaces.
      phone: z
        .string()
        .transform((v) => normalizeDigits(v).replace(/[-().]/g, " ").replace(/\s+/g, " ").trim())
        .refine((v) => v === "" || isPhone(v), { error: "homeEditor.errors.phone" }),
    }),
  })
  .superRefine((home, ctx) => {
    // The background chosen must have something to show.
    if (home.hero.media === "images" && home.hero.images.length === 0) {
      ctx.addIssue({ code: "custom", path: ["hero", "images"], message: "homeEditor.errors.photosNeeded" })
    }
    if (home.hero.media === "video" && home.hero.video === "") {
      ctx.addIssue({ code: "custom", path: ["hero", "video"], message: "homeEditor.errors.videoNeeded" })
    }
  })

export type HomeSettingsInput = z.input<typeof homeSettingsSchema>
export type HomeSettingsValues = z.output<typeof homeSettingsSchema>

/** A text in every language. */
export type Texts = Record<Locale, string>

/**
 * The template's own texts (messages/<locale>/home.json) in every language:
 * what the site shows for a field left empty, so the form shows them as placeholders.
 */
export type HomeDefaults = {
  hero: { title: Texts; subtitle: Texts; button: Texts }
  story: { title: Texts; text: Texts; button: Texts }
  crafts: { title: Texts }
  past: { title: Texts }
  steps: { title: Texts; items: { title: Texts; text: Texts }[] }
  footer: { about: Texts }
}

/** Every file a home value uses (the hero's photos, video and poster, the sections' photos). */
export function homeFiles(home: {
  hero: { images: string[]; video: string; poster: string }
  story: { image: string }
  crafts: { image: string }
  steps: { image: string }
}): string[] {
  return [...home.hero.images, home.hero.video, home.hero.poster, home.story.image, home.crafts.image, home.steps.image].filter(Boolean)
}
