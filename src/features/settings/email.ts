import "server-only"
import type { z } from "zod"

import { encrypt } from "@/lib/crypto"
import { env } from "@/lib/env"
import { UserError } from "@/lib/errors"
import { settingSchemas, type SettingValue } from "@/lib/settings"
import type { EmailView, emailSettingsSchema } from "./schema"

type EmailSetting = SettingValue<"email">
type EmailInput = z.output<typeof emailSettingsSchema>

/** The server's own sender: the address in EMAIL_FROM ("Name <a@b.c>" or "a@b.c"). */
const serverFrom = () => env.EMAIL_FROM?.match(/<([^<>\s]+)>\s*$/)?.[1] ?? env.EMAIL_FROM?.trim() ?? ""

/** The saved setting as the browser may see it: never a key, a password or their ciphertext. */
export function emailView(setting: EmailSetting): EmailView {
  const { host, port, security, user, passwordEnc } = setting.smtp
  return {
    provider: setting.provider,
    fromAddress: setting.fromAddress,
    replyTo: setting.replyTo,
    smtp: { host, port, security, user },
    saved: { resendKey: Boolean(setting.resendKeyEnc), smtpPassword: Boolean(passwordEnc) },
    server: { resendKey: Boolean(env.RESEND_API_KEY), fromAddress: serverFrom() },
  }
}

/**
 * The setting to store for the submitted form. A new key or password is
 * encrypted; an empty one keeps the saved one. Both providers' settings are
 * kept, so switching back and forth loses nothing. `replaced` names the
 * secrets that were given a new value (for the audit log, never the values).
 */
export function buildEmailSetting(input: EmailInput, current: EmailSetting): { setting: EmailSetting; replaced: string[] } {
  const replaced: string[] = []
  const resendKeyEnc = input.resendKey ? encrypt(input.resendKey) : current.resendKeyEnc
  if (input.resendKey) replaced.push("resendKey")
  if (input.provider === "resend" && !resendKeyEnc && !env.RESEND_API_KEY) {
    throw new UserError("settings.email.errors.keyRequired", { field: "resendKey" })
  }

  // No user name: the server takes mail without signing in (a relay on the same server), so no password either.
  let passwordEnc = input.smtpUser ? current.smtp.passwordEnc : ""
  if (input.smtpUser && input.smtpPassword) {
    passwordEnc = encrypt(input.smtpPassword)
    replaced.push("smtpPassword")
  }
  if (input.provider === "smtp" && input.smtpUser && !passwordEnc) {
    throw new UserError("settings.email.errors.passwordRequired", { field: "smtpPassword" })
  }

  const setting = settingSchemas.email.parse({
    provider: input.provider,
    fromAddress: input.fromAddress,
    replyTo: input.replyTo,
    resendKeyEnc,
    smtp: {
      host: input.smtpHost,
      port: input.smtpPort,
      security: input.smtpSecurity,
      user: input.smtpUser,
      passwordEnc,
    },
  })
  return { setting, replaced }
}
