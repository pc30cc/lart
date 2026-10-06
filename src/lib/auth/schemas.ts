/**
 * Password rules and the Zod schemas of the auth forms. No server-only or
 * native imports: client forms validate with the same schemas as the actions.
 */
import { z } from "zod"

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 256

/** Length rules only: a long passphrase beats character-class rules. */
const newPassword = () => z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)
const confirmed = (v: { next: string; confirm: string }) => v.next === v.confirm
const mismatch = { path: ["confirm"], error: "auth.password.errors.mismatch" }

/** Signed-in admin: change the password (user menu). */
export const changePasswordSchema = z
  .object({
    current: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    next: newPassword(),
    confirm: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .refine(confirmed, mismatch)
  .refine((v) => v.next !== v.current, { path: ["next"], error: "auth.password.errors.same" })

/** "Forgot your password?": the email to send the reset link to. */
export const forgotPasswordSchema = z.object({ email: z.email().max(254) })

/** The reset page: the token from the link and the new password. */
export const resetPasswordSchema = z
  .object({
    token: z.string().min(1).max(128),
    next: newPassword(),
    confirm: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .refine(confirmed, mismatch)
