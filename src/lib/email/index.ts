import "server-only"
import nodemailer, { type Transporter } from "nodemailer"
import { Resend } from "resend"
import { z } from "zod"

import { type EmailLocale, type RenderedEmail, renderEmail } from "@/emails"
import type { EmailProps, EmailTemplate } from "@/emails/templates"
import { decrypt } from "@/lib/crypto"
import { env } from "@/lib/env"
import { getBrand, getSetting, type SettingValue } from "@/lib/settings"

export { renderEmail }
export type { EmailLocale, EmailProps, EmailTemplate, RenderedEmail }

export type SendEmailInput<T extends EmailTemplate> = {
  /** One address, or up to 50. */
  to: string | string[]
  template: T
  props: EmailProps<T>
  /** The recipient's language. Anything else uses the default-language setting (Turkish unless changed). */
  locale?: string | null
  /** Optional idempotency key (Resend only), so a retried job never sends the same email twice. */
  idempotencyKey?: string
}

/** `error` is for server logs and admins, never for showing to visitors. */
export type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string }

const recipients = z.union([z.email().max(254), z.array(z.email().max(254)).min(1).max(50)])
const emailLocales: readonly string[] = ["fa", "tr", "en"] satisfies EmailLocale[]

/** How one email leaves the server. */
export type EmailTransport =
  | { kind: "resend"; apiKey: string }
  | {
      kind: "smtp"
      host: string
      port: number
      security: "tls" | "starttls" | "none"
      user: string
      password: string
    }

/** The transport and addresses in use; `transport` is null when nothing is configured. */
export type EmailConfig = { transport: EmailTransport | null; fromAddress: string; replyTo: string }

/**
 * The email setting (Settings → Email) with its key or password decrypted.
 * While it is not set (`env`), the server's RESEND_API_KEY / EMAIL_FROM; a
 * Resend setting without its own key also uses RESEND_API_KEY.
 */
export function emailConfig(setting: SettingValue<"email">): EmailConfig {
  const fromAddress = setting.fromAddress || env.EMAIL_FROM || ""
  const replyTo = setting.replyTo
  if (setting.provider === "smtp") {
    const { host, port, security, user, passwordEnc } = setting.smtp
    if (!host) return { transport: null, fromAddress, replyTo }
    const password = passwordEnc ? decrypt(passwordEnc) : ""
    return { transport: { kind: "smtp", host, port, security, user, password }, fromAddress, replyTo }
  }
  const ownKey = setting.provider === "resend" && setting.resendKeyEnc ? decrypt(setting.resendKeyEnc) : ""
  const apiKey = ownKey || env.RESEND_API_KEY
  return { transport: apiKey ? { kind: "resend", apiKey } : null, fromAddress, replyTo }
}

export type EmailMessage = { from: string; to: string | string[]; subject: string; html: string; text: string; replyTo?: string }

const resendClients = new Map<string, Resend>()
const smtpTransports = new Map<string, Transporter>()

/** Hand one message to Resend or the SMTP server. Never throws. */
export async function deliver(transport: EmailTransport, message: EmailMessage, idempotencyKey?: string): Promise<SendEmailResult> {
  try {
    if (transport.kind === "resend") {
      let client = resendClients.get(transport.apiKey)
      if (!client) resendClients.set(transport.apiKey, (client = new Resend(transport.apiKey)))
      const { data, error } = await client.emails.send(message, idempotencyKey ? { idempotencyKey } : undefined)
      return error ? { ok: false, error: `Resend ${error.name}: ${error.message}` } : { ok: true, id: data.id }
    }
    const cacheKey = JSON.stringify(transport)
    let smtp = smtpTransports.get(cacheKey)
    if (!smtp) {
      smtp = nodemailer.createTransport({
        host: transport.host,
        port: transport.port,
        secure: transport.security === "tls",
        requireTLS: transport.security === "starttls",
        ignoreTLS: transport.security === "none",
        auth: transport.user ? { user: transport.user, pass: transport.password } : undefined,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      })
      smtpTransports.set(cacheKey, smtp)
    }
    const info = await smtp.sendMail(message)
    return { ok: true, id: info.messageId }
  } catch (err) {
    return { ok: false, error: `${transport.kind.toUpperCase()}: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Send a transactional email. Never throws: failures come back as
 * `{ ok: false, error }` (and are logged), so the caller's main flow goes on.
 * With no provider configured the email is printed to the server log instead
 * (development and tests only; in production that is an error).
 */
export async function sendEmail<T extends EmailTemplate>(input: SendEmailInput<T>): Promise<SendEmailResult> {
  const { template } = input
  try {
    const to = recipients.safeParse(input.to)
    if (!to.success) return fail(template, "invalid recipient address")
    const locale = await emailLocale(input.locale)
    const email = await renderEmail(template, input.props, locale)
    const config = emailConfig(await getSetting("email"))

    if (!config.transport) {
      if (env.NODE_ENV === "production") return fail(template, "no email provider (Settings → Email, or RESEND_API_KEY)")
      logEmail(to.data, email)
      return { ok: true }
    }

    const from = sender(config.fromAddress, await getBrand(locale))
    if (!from) return fail(template, "the sender address (Settings → Email, or EMAIL_FROM) is missing or not valid")

    const message: EmailMessage = { from, to: to.data, subject: email.subject, html: email.html, text: email.text }
    if (config.replyTo) message.replyTo = config.replyTo
    const result = await deliver(config.transport, message, input.idempotencyKey)
    return result.ok ? result : fail(template, result.error)
  } catch (err) {
    return fail(template, err instanceof z.ZodError ? `invalid props: ${z.prettifyError(err)}` : String(err))
  }
}

async function emailLocale(locale: string | null | undefined): Promise<EmailLocale> {
  if (locale && emailLocales.includes(locale)) return locale as EmailLocale
  try {
    return await getSetting("defaultLocale")
  } catch {
    return "tr"
  }
}

/**
 * "Brand <address>": the address comes from EMAIL_FROM ("Name <a@b.c>" or "a@b.c"),
 * the display name is always the brand setting, so renaming the brand renames the sender.
 */
export function sender(emailFrom: string | undefined, brand: string): string | null {
  const address = emailFrom?.match(/<([^<>\s]+)>\s*$/)?.[1] ?? emailFrom?.trim()
  if (!address || !z.email().safeParse(address).success) return null
  const name = brand.replace(/["\\<>\r\n]/g, "").trim()
  return name ? `"${name}" <${address}>` : address
}

function fail(template: string, error: string): SendEmailResult {
  console.error(`[email] ${template} not sent: ${error}`)
  return { ok: false, error }
}

function logEmail(to: string | string[], email: RenderedEmail) {
  const links = [...new Set(Array.from(email.html.matchAll(/href="([^"]+)"/g), (m) => m[1].replaceAll("&amp;", "&")))]
  console.info(
    [
      "──── email (not sent: no email provider is set) ────",
      `To: ${[to].flat().join(", ")}`,
      `Subject: ${email.subject}`,
      `Links: ${links.join("  ")}`,
      "",
      email.text,
      "─".repeat(52),
    ].join("\n"),
  )
}
