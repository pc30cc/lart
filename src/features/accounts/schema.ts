/**
 * The forms of member and instructor accounts. No server-only imports: the
 * client forms validate with the same schemas as the actions.
 */
import { z } from "zod"

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

/** Sign up: name, email, password and an optional phone. The language is the page's. */
export const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
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

/**
 * One-time notices an action leaves for the next page as `?notice=…`: the site
 * layout shows them as a toast (messages: site.notices.<notice>) and removes
 * the parameter. Only these values are ever shown.
 */
export const siteNotices = ["checkEmail", "signedOut", "passwordSaved"] as const
export type SiteNotice = (typeof siteNotices)[number]

export const isSiteNotice = (value: unknown): value is SiteNotice =>
  typeof value === "string" && (siteNotices as readonly string[]).includes(value)

/** `path` (a safe, same-site path with an optional query) with `?notice=…` added. */
export function withNotice(path: string, notice: SiteNotice): string {
  const url = new URL(path, "http://notice.invalid")
  url.searchParams.set("notice", notice)
  return url.pathname + url.search
}
