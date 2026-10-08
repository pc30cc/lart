/**
 * The forms of member and instructor accounts. No server-only imports: the
 * client forms validate with the same schemas as the actions.
 */
import { z } from "zod"

import { uuid } from "@/components/admin/form/schemas"
import { idNumberGiven, idNumberRequired, instructorFields } from "@/features/instructors/schema"
import { locales } from "@/i18n/routing"
import { ACCOUNT_PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@/lib/auth/schemas"
import { normalizeDigits } from "@/lib/format"

/** Trimmed and lower-case, as emails are stored. */
const email = () => z.string().trim().toLowerCase().min(1).max(254).pipe(z.email())
/** Length rules only: a long passphrase beats character-class rules. */
const newPassword = () => z.string().min(ACCOUNT_PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)
const next = z.string().max(300).optional()
const token = z.string().min(1).max(128)

/** "+90 532 123 45 67", "0532…", Persian digits → "+905321234567" / "05321234567"; empty stays empty. */
export function normalizePhone(input: string): string {
  const compact = normalizeDigits(input).replace(/[\s\-().‎‏‪-‮]/g, "")
  return compact.startsWith("00") ? `+${compact.slice(2)}` : compact
}

/**
 * True for text that could be a link, an email address or a phone number:
 * any digit (Latin, Persian or Arabic), `@ / \ : < >`, "www." or a
 * domain-like "word.tld". Initials ("J.R.", "A. Yılmaz") are fine.
 */
export function looksLikeContact(value: string): boolean {
  return (
    /\p{Nd}/u.test(value) ||
    /[@/\\:<>]/.test(value) ||
    /www\./i.test(value) ||
    /[\p{L}\p{N}-]{2,}\.\p{L}{2,}/u.test(value)
  )
}

/**
 * A person's name, as members type it (sign up, their profile). It is the
 * greeting of the emails we send them, so it may not carry a link, an email
 * address or a phone number: otherwise anyone could send a branded welcome
 * email with their own text to any address.
 */
export const personName = () =>
  z
    .string()
    .trim()
    .min(2)
    .max(80)
    .refine((v) => !looksLikeContact(v), { error: "account.signup.errors.name" })

/** Sign up: name, email, password and an optional phone. The language is the page's. */
export const signupSchema = z.object({
  name: personName(),
  email: email(),
  password: newPassword(),
  phone: z
    .string()
    .max(40)
    .optional()
    .transform((v) => normalizePhone(v ?? ""))
    .refine((v) => v === "" || /^\+?\d{7,15}$/.test(v), { error: "account.signup.errors.phone" }),
  next,
})

/**
 * An instructor's own sign-up (`/<locale>/instructor/signup`): the same fields
 * and rules as the admins' instructor form, minus the photo (added later in
 * the panel, which can upload), plus a password and "my details are correct".
 * The display name is the greeting of the emails we send, so, like a member's
 * name, it may not carry a link, an email address or a phone number.
 */
export const instructorSignupSchema = instructorFields
  .omit({ photoPath: true, inviteLocale: true })
  .extend({
    displayName: instructorFields.shape.displayName.check((ctx) => {
      for (const [locale, name] of Object.entries(ctx.value)) {
        if (name && looksLikeContact(name)) {
          ctx.issues.push({ code: "custom", input: name, path: [locale], message: "account.signup.errors.name" })
        }
      }
    }),
    password: newPassword(),
    agree: z.literal(true, { error: "auth.instructor.signup.errors.agree" }),
  })
  .refine(idNumberGiven, idNumberRequired)

export type InstructorSignupValues = z.input<typeof instructorSignupSchema>

/** Sign in (members and instructors). */
export const accountLoginSchema = z.object({
  email: email(),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  next,
})

/** "Forgot your password?" */
export const accountForgotSchema = z.object({ email: email() })

/** A new password from an emailed link: the reset page and the instructor's invitation. */
export const accountPasswordSchema = z.object({ token, password: newPassword() })

/** The token of a verify link. */
export const accountTokenSchema = z.object({ token })

/** The language of the person's emails (and the instructor's panel). */
export const accountLocaleSchema = z.object({ locale: z.enum(locales) })

export type SignupValues = z.input<typeof signupSchema>

/** A super admin sets a member's or instructor's password, typed (the person's own rules). */
export const adminPasswordTypedSchema = z.object({ id: uuid(), mode: z.literal("type"), password: newPassword() })

/** …or generated on the server (shown once to the admin, never stored or logged). */
export const adminPasswordSchema = z.discriminatedUnion("mode", [
  z.object({ id: uuid(), mode: z.literal("generate") }),
  adminPasswordTypedSchema,
])

export type AdminPasswordTypedValues = z.input<typeof adminPasswordTypedSchema>

// The notices live in a module of their own (no zod): the site layout's toast reads them on every page.
export { isSiteNotice, siteNotices, withNotice, type SiteNotice } from "./notices"
