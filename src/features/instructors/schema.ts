import { z } from "zod"

import { localizedText, uuid } from "@/components/admin/form/schemas"
import type { LocalizedText } from "@/db/schema"
import { localized, normalizeDigits } from "@/lib/format"
import { isSafePath } from "@/lib/storage/shared"

/**
 * Instructor fields, shared by the form (client) and the actions (server).
 * Private fields (official name, ID number, mobile, email) never reach the public site.
 */

/** Languages an instructor can teach in (ISO 639-1). The UI names them with Intl.DisplayNames. */
export const teachingLanguageCodes = [
  "fa", "tr", "en", "ar", "az", "ku", "de", "fr", "es", "it", "ru", "uk",
  "el", "hy", "ka", "ps", "ur", "hi", "zh", "ja", "ko", "pt", "nl",
] as const
export type TeachingLanguage = (typeof teachingLanguageCodes)[number]

/** Languages the invitation email can be written in. */
export const inviteLocales = ["fa", "tr", "en"] as const
export type InviteLocale = (typeof inviteLocales)[number]

/** How long an invitation link stays valid. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Storage prefix of profile photos (the `instructor_photo` upload purpose). */
export const PHOTO_PREFIX = "instructors/"

/** "+90 532 123 45 67", "0090 532…", Persian digits → "+905321234567". */
export function normalizeMobile(input: string): string {
  const compact = normalizeDigits(input).replace(/[\s\-().‎‏‪-‮]/g, "")
  return compact.startsWith("00") ? `+${compact.slice(2)}` : compact
}

/** ID numbers are kept as upper-case letters and digits ("12345 678-901" → "12345678901"). */
export function normalizeIdNumber(input: string): string {
  return normalizeDigits(input).replace(/[\s\-.]/g, "").toUpperCase()
}

/** "@name" → the Instagram profile; "example.com" → "https://example.com". */
export function normalizeWebsite(input: string): string {
  const value = input.trim()
  if (!value) return ""
  const handle = /^@([A-Za-z0-9._]{1,30})$/.exec(value)
  if (handle) return `https://www.instagram.com/${handle[1]}`
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
}

/**
 * The public text of a profile in a language. Persian falls back to English
 * (the brief: the English display name is shown on the Persian site).
 */
export function profileText(text: LocalizedText | null | undefined, locale: string): string {
  if (!text) return ""
  const own = locale === "fa" ? text.fa?.trim() || text.en?.trim() : text[locale as keyof LocalizedText]?.trim()
  return own || localized(text, locale)
}

const displayNames = new Map<string, Intl.DisplayNames>()

/** A language code named in a language: ("tr", "en") → "Turkish", ("tr", "tr") → "Türkçe". */
export function languageName(code: string, inLocale: string): string {
  try {
    let names = displayNames.get(inLocale)
    if (!names) displayNames.set(inLocale, (names = new Intl.DisplayNames([inLocale], { type: "language" })))
    return names.of(code) ?? code
  } catch {
    return code
  }
}

/** Last three characters, the rest hidden: "••••••901". */
export function maskIdNumber(idNumber: string): string {
  return `••••••${idNumber.slice(-3)}`
}

const ID_NUMBER = /^[A-Z0-9]{5,20}$/
const httpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain })

const fields = z.object({
  // Public, required.
  displayName: localizedText({ required: ["tr", "en"], max: 80 }),
  teachingField: localizedText({ required: ["tr", "en"], max: 80 }),
  // Private, required.
  officialName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .transform((v) => v.replace(/\s+/g, " ")),
  /** Empty on edit = keep the stored one (it is never sent to the browser). */
  idNumber: z
    .string()
    .optional()
    .transform((v) => normalizeIdNumber(v ?? ""))
    .refine((v) => v === "" || ID_NUMBER.test(v), { error: "instructors.errors.idNumber" })
    .transform((v) => v || undefined),
  mobile: z
    .string()
    .transform(normalizeMobile)
    .pipe(z.string().min(1).regex(/^\+[1-9]\d{7,14}$/, { error: "instructors.errors.mobile" })),
  email: z.string().trim().toLowerCase().min(1).max(254).pipe(z.email()),
  // Public, optional.
  bio: localizedText({ max: 600 }),
  teachingLanguages: z
    .array(z.enum(teachingLanguageCodes))
    .max(teachingLanguageCodes.length)
    .transform((codes) => [...new Set(codes)]),
  website: z
    .string()
    .trim()
    .max(300)
    .transform(normalizeWebsite)
    .refine((v) => v === "" || httpsUrl.safeParse(v).success, { error: "common.validation.url" })
    .transform((v) => v || null),
  photoPath: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || (isSafePath(v) && v.startsWith(PHOTO_PREFIX)), {
      error: "instructors.errors.photo",
    }),
  /** Create only: the language of the invitation email. */
  inviteLocale: z.enum(inviteLocales).optional(),
})

/**
 * Create: the ID number is required. `when` runs the check even while other
 * fields are invalid, so every problem is shown at once.
 */
export const instructorSchema = fields.refine((v) => (v as { idNumber?: unknown }).idNumber !== undefined, {
  path: ["idNumber"],
  error: "common.validation.required",
  when: (payload) => typeof payload.value === "object" && payload.value !== null,
})
/** Edit form: an empty ID number keeps the stored one. */
export const instructorEditSchema = fields
export const instructorUpdateSchema = fields.omit({ inviteLocale: true }).extend({ id: uuid() })
export const instructorIdSchema = z.object({ id: uuid() })
export const instructorActiveSchema = z.object({ id: uuid(), active: z.boolean() })
export const resendInviteSchema = z.object({ id: uuid(), locale: z.enum(inviteLocales) })

export type InstructorFormValues = z.input<typeof instructorSchema>

/** List page: sortable columns and filters (validated by parseTableParams). */
export const instructorTable = {
  sort: ["name", "workshops"] as const,
  filters: { status: ["active", "inactive", "invited"] as const },
}
