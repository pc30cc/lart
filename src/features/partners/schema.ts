/**
 * Partners (the super admins): inviting a new partner, the invitation's page
 * and each partner's own profile. The form schemas are shared by the client
 * forms and the actions, so no server-only imports here.
 */
import { z } from "zod"

import { localizedText, uuid } from "@/components/admin/form/schemas"
import { locales } from "@/i18n/routing"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas"
import { isSafePath } from "@/lib/storage/shared"

export { MAX_PARTNERS, PARTNER_INVITE_TTL_MS } from "./limits"

/** Storage prefix of partners' photos (the `admin_photo` upload purpose): `partners/<name>/photo-<random>.webp`. */
export const ADMIN_PHOTO_PREFIX = "partners/"
/** Where partners' photos uploaded before the named folders are (`admins/<yyyy-mm>/<random>.webp`). */
const OLD_ADMIN_PHOTO_PREFIX = "admins/"

/** A path the `admin_photo` upload can have produced. */
export const isAdminPhotoPath = (path: unknown): path is string =>
  isSafePath(path) && (path.startsWith(ADMIN_PHOTO_PREFIX) || path.startsWith(OLD_ADMIN_PHOTO_PREFIX)) && path.endsWith(".webp")

/** Trimmed and lower-case, as admin emails are stored (the admin login compares them exactly). */
const email = () => z.string().trim().toLowerCase().min(1).max(254).pipe(z.email())

/** A partner's name: 2 to 80 characters, inner spaces collapsed. */
const partnerName = () =>
  z
    .string()
    .trim()
    .min(2)
    .max(80)
    .transform((v) => v.replace(/\s+/g, " "))

/** "Invite a partner": who, and the language of the email and the invitation page. */
export const partnerInviteSchema = z.object({
  name: partnerName(),
  email: email(),
  locale: z.enum(locales),
})

/** "Send again" and "Cancel" of an invitation. */
export const partnerInviteIdSchema = z.object({ id: uuid() })

/** The invitation page: the token from the link and the new partner's password (the admin rules). */
export const acceptPartnerInviteSchema = z.object({
  token: z.string().min(1).max(128),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})

/**
 * My profile: name, email and photo. A new email needs the current password
 * (`currentPassword`; leave it empty otherwise). `photoPath` is the storage path
 * from the `admin_photo` upload, or null for no photo.
 */
export const profileSchema = z.object({
  name: partnerName(),
  email: email(),
  photoPath: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || isAdminPhotoPath(v), { error: "partners.profile.errors.photo" }),
  currentPassword: z
    .string()
    .max(PASSWORD_MAX_LENGTH)
    .optional()
    .transform((v) => v || undefined),
})

/** A path the `partner_portrait` upload can have produced: `partners/<name>/portrait-<random>.webp`. */
export const isPartnerPortraitPath = (path: unknown): path is string =>
  isSafePath(path) && path.startsWith(ADMIN_PHOTO_PREFIX) && /\/portrait-[A-Za-z0-9_-]+\.webp$/.test(path)

export const ABOUT_NAME_MAX = 80
export const ABOUT_ROLE_MAX = 80
export const ABOUT_BIO_MAX = 3000

/**
 * My profile → "On the Our story page": whether I am shown on the public Our story
 * page (my consent), my portrait (the `partner_portrait` upload, or null),
 * my name as each language writes it (optional: else my name), my role and
 * a few words about me. While shown, the words are needed in every language:
 * each language's page has its own, never another's. A hidden entry may be a
 * draft.
 */
export const aboutProfileSchema = z
  .object({
    aboutShown: z.boolean(),
    aboutName: localizedText({ max: ABOUT_NAME_MAX }),
    aboutRole: localizedText({ max: ABOUT_ROLE_MAX }),
    aboutBio: localizedText({ max: ABOUT_BIO_MAX }),
    portraitPath: z
      .string()
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || isPartnerPortraitPath(v), { error: "partners.about.errors.portrait" }),
  })
  .superRefine((v, ctx) => {
    if (!v.aboutShown) return
    for (const l of locales) {
      if (!v.aboutBio[l]) ctx.addIssue({ code: "custom", path: ["aboutBio", l], message: "common.validation.required" })
    }
  })

export type PartnerInviteValues = z.input<typeof partnerInviteSchema>
export type AcceptPartnerInviteValues = z.input<typeof acceptPartnerInviteSchema>
export type ProfileValues = z.input<typeof profileSchema>
export type AboutProfileValues = z.input<typeof aboutProfileSchema>

/**
 * One-time notices an admin action leaves for the next page as `?notice=…`
 * (messages: partners.notices.<notice>), e.g. "welcome" after accepting an
 * invitation. Only these values are ever shown.
 */
export const adminNotices = ["welcome"] as const
export type AdminNotice = (typeof adminNotices)[number]

export const isAdminNotice = (value: unknown): value is AdminNotice =>
  typeof value === "string" && (adminNotices as readonly string[]).includes(value)

/** `path` (a same-site admin path) with `?notice=…` added. */
export function withAdminNotice(path: string, notice: AdminNotice): string {
  const url = new URL(path, "http://notice.invalid")
  url.searchParams.set("notice", notice)
  return url.pathname + url.search
}
