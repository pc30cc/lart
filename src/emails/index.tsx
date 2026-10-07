import "server-only"
import { createTranslator } from "next-intl"
import { render, toPlainText } from "react-email"

import { env } from "@/lib/env"
import { errorForLog } from "@/lib/errors"
import { formatNumber } from "@/lib/format"
import { getBrand, getSetting, type SettingValue } from "@/lib/settings"
import en from "../../messages/en/emails.json"
import fa from "../../messages/fa/emails.json"
import tr from "../../messages/tr/emails.json"
import { EmailLayout } from "./layout"
import { type EmailDefinition, type EmailProps, type EmailTemplate, emailPlaceholders, emailTemplates } from "./templates"

export type EmailLocale = "fa" | "tr" | "en"
export type RenderedEmail = { subject: string; html: string; text: string }
/** The admin's texts of one email (part of the `emailTexts` setting): field → { fa?, tr?, en? }. */
export type EmailTexts = NonNullable<SettingValue<"emailTexts">[EmailTemplate]>

type Messages = typeof tr
// Typed by the Turkish file, so a key missing in fa or en fails the type check.
const messages: Record<EmailLocale, Messages> = { fa, tr, en }

/** The bundled texts of an email in a language (messages/<locale>/emails.json). */
export function defaultEmailTexts(template: EmailTemplate, locale: EmailLocale): Record<string, string> {
  return { ...(messages[locale][template] as Record<string, string>) }
}

/** The bundled messages with the admin's non-empty texts for this email and language laid over them. */
function withTexts(template: EmailTemplate, locale: EmailLocale, texts: EmailTexts | undefined): Messages {
  const own = Object.entries(texts ?? {}).flatMap(([field, text]) => {
    const value = text?.[locale]?.trim()
    return value ? [[field, value] as const] : []
  })
  if (!own.length) return messages[locale]
  return { ...messages[locale], [template]: { ...messages[locale][template], ...Object.fromEntries(own) } }
}

/**
 * Render a template in a language: validates the props (throws a ZodError on
 * bad input, e.g. a link that is not on this site), then builds the subject,
 * the HTML and the plain-text version. Brand name from the `brand` setting.
 * The texts are the admin's (`emailTexts` setting, templates page) where set,
 * else the bundled ones; if the admin's texts cannot be used, the email goes
 * out with the bundled texts and the problem is logged. `texts` replaces the
 * saved ones (the templates page previews unsaved changes with it).
 */
export async function renderEmail<T extends EmailTemplate>(
  template: T,
  props: EmailProps<T>,
  locale: EmailLocale,
  options: { texts?: EmailTexts } = {},
): Promise<RenderedEmail> {
  const def = emailTemplates[template] as unknown as EmailDefinition
  const p = def.schema.parse(props) as Record<string, unknown>
  const brand = await getBrand(locale)
  let custom = messages[locale]
  try {
    custom = withTexts(template, locale, options.texts ?? (await getSetting("emailTexts"))[template])
  } catch (err) {
    console.error(`[email] ${template}: could not load the edited texts, using the default ones`, errorForLog(err))
  }
  if (custom === messages[locale]) return build(template, def, p, locale, brand, custom)
  try {
    return await build(template, def, p, locale, brand, custom)
  } catch (err) {
    if (options.texts) throw err
    console.error(`[email] ${template} (${locale}): the edited texts failed, sent with the default ones`, errorForLog(err))
    return build(template, def, p, locale, brand, messages[locale])
  }
}

async function build(
  template: EmailTemplate,
  def: EmailDefinition,
  p: Record<string, unknown>,
  locale: EmailLocale,
  brand: string,
  source: Messages,
): Promise<RenderedEmail> {
  const t = createTranslator({
    locale,
    messages: source,
    // A missing message or value is a bug: fail loudly instead of sending "emails.x.y".
    onError: (error) => {
      throw error
    },
  })
  type Key = Parameters<typeof t>[0]
  // Only text and numbers are placeholders; objects (e.g. the bank account) go to `sections`.
  const scalars = Object.fromEntries(
    Object.entries(p).filter((entry): entry is [string, string | number] => ["string", "number"].includes(typeof entry[1])),
  )
  const values = { ...scalars, ...def.values?.(p as never), brand }
  const msg = (key: string) => t(`${template}.${key}` as Key, values)
  const optional = (key: string) => (t.has(`${template}.${key}` as Key) ? msg(key) : undefined)
  const shared = (key: string) => t(key as Key, values)
  const home = new URL(`/${locale}`, env.APP_URL).href

  const details = Object.entries(def.details ?? {}).flatMap(([label, key]) => {
    const value = p[key as string]
    if (value === undefined || value === "") return []
    return [{ label: t(`details.${label}` as Key), value: typeof value === "number" ? formatNumber(value, locale) : String(value) }]
  })
  const sections = (def.sections?.(p as never) ?? []).map((section) => ({
    title: shared(section.title),
    text: section.text.map(shared),
    rows: (section.rows ?? []).map((row) => ({ label: shared(row.label), value: row.value, ltr: row.ltr })),
    after: [...(section.after ?? []).map(shared), ...(section.note ? [section.note] : [])],
    button: section.button && { label: shared(section.button.label), href: section.button.href },
  }))

  const html = await render(
    <EmailLayout
      locale={locale}
      brand={brand}
      siteUrl={home}
      preview={msg("preview")}
      heading={msg("heading")}
      greeting={t("layout.greeting", { name: String(p[def.greet]) })}
      paragraphs={[msg("intro"), optional("intro2")].filter((x): x is string => !!x)}
      details={details}
      sections={sections}
      cta={{ label: msg("cta"), href: (p[def.cta] as string | undefined) ?? home }}
      note={optional("note")}
      noteHref={def.noteLink ? (p[def.noteLink] as string | undefined) : undefined}
      linkHint={t("layout.linkHint")}
      signoff={t("layout.signoff")}
      team={t("layout.team", { brand })}
      footer={t("layout.footer", { brand })}
    />,
  )
  const text = toPlainText(html, {
    selectors: [
      // Upper-casing breaks Turkish ("Yeriniz" → "YERINIZ") and means nothing in Persian.
      { selector: "h1", options: { uppercase: false } },
      { selector: "a.e-footer", format: "anchor", options: { ignoreHref: true } },
    ],
  })
  // One line, no control characters: user-entered titles end up in the subject.
  const subject = msg("subject").replace(/\s+/g, " ").trim()
  return { subject, html, text }
}

/** Why an email text cannot be used: broken braces, an unknown {placeholder}, or a number format on text. */
export type EmailTextProblem = { problem: "syntax" } | { problem: "placeholder"; name: string } | { problem: "number" }

/**
 * Checks one text an admin wrote for an email (ICU message format, as in
 * emails.json): it must compile and use only that email's placeholders.
 * Returns null when the text is fine.
 */
export function checkEmailText(template: EmailTemplate, text: string, locale: EmailLocale): EmailTextProblem | null {
  const { names, numbers } = emailPlaceholders(template)
  // Sample values: numbers where the email passes numbers, a word elsewhere ("other" in a select).
  const values = Object.fromEntries(names.map((name) => [name, numbers.includes(name) ? 3 : "sample"]))
  const problems: { code?: string; message?: string }[] = []
  const t = createTranslator({ locale, messages: { text }, onError: (error) => problems.push(error) })
  let out = ""
  try {
    out = t("text" as never, values as never)
  } catch (err) {
    problems.push(err as Error)
  }
  const first = problems[0]
  if (first) {
    const missing = /variable "([^"]+)" was not provided/.exec(first.message ?? "")
    return missing ? { problem: "placeholder", name: missing[1] } : { problem: "syntax" }
  }
  // A plural or number format on a text placeholder prints NaN.
  return out.includes("NaN") && !text.includes("NaN") ? { problem: "number" } : null
}
