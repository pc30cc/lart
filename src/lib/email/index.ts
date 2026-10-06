import "server-only"
import { Resend } from "resend"
import { z } from "zod"

import { type EmailLocale, type RenderedEmail, renderEmail } from "@/emails"
import type { EmailProps, EmailTemplate } from "@/emails/templates"
import { env } from "@/lib/env"
import { getBrand, getSetting } from "@/lib/settings"

export { renderEmail }
export type { EmailLocale, EmailProps, EmailTemplate, RenderedEmail }

export type SendEmailInput<T extends EmailTemplate> = {
  /** One address, or up to 50. */
  to: string | string[]
  template: T
  props: EmailProps<T>
  /** The recipient's language. Anything else uses the default-language setting (Turkish unless changed). */
  locale?: string | null
  /** Optional Resend idempotency key, so a retried job never sends the same email twice. */
  idempotencyKey?: string
}

/** `error` is for server logs, never for showing to people. */
export type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string }

const recipients = z.union([z.email().max(254), z.array(z.email().max(254)).min(1).max(50)])
const emailLocales: readonly string[] = ["fa", "tr", "en"] satisfies EmailLocale[]

let client: Resend | undefined

/**
 * Send a transactional email. Never throws: failures come back as
 * `{ ok: false, error }` (and are logged), so the caller's main flow goes on.
 * Without RESEND_API_KEY the email is printed to the server log instead
 * (development and tests only; in production that is an error).
 */
export async function sendEmail<T extends EmailTemplate>(input: SendEmailInput<T>): Promise<SendEmailResult> {
  const { template } = input
  try {
    const to = recipients.safeParse(input.to)
    if (!to.success) return fail(template, "invalid recipient address")
    const locale = await emailLocale(input.locale)
    const email = await renderEmail(template, input.props, locale)

    if (!env.RESEND_API_KEY) {
      if (env.NODE_ENV === "production") return fail(template, "RESEND_API_KEY is not set")
      logEmail(to.data, email)
      return { ok: true }
    }

    const from = sender(env.EMAIL_FROM, await getBrand(locale))
    if (!from) return fail(template, "EMAIL_FROM is missing or has no valid address")

    client ??= new Resend(env.RESEND_API_KEY)
    const { data, error } = await client.emails.send(
      { from, to: to.data, subject: email.subject, html: email.html, text: email.text },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    )
    if (error) return fail(template, `Resend ${error.name}: ${error.message}`)
    return { ok: true, id: data.id }
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
      "──── email (not sent: RESEND_API_KEY is not set) ────",
      `To: ${[to].flat().join(", ")}`,
      `Subject: ${email.subject}`,
      `Links: ${links.join("  ")}`,
      "",
      email.text,
      "─".repeat(52),
    ].join("\n"),
  )
}
