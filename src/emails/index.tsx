import "server-only"
import { createTranslator } from "next-intl"
import { render, toPlainText } from "react-email"

import { env } from "@/lib/env"
import { formatNumber } from "@/lib/format"
import { getBrand } from "@/lib/settings"
import en from "../../messages/en/emails.json"
import fa from "../../messages/fa/emails.json"
import tr from "../../messages/tr/emails.json"
import { EmailLayout } from "./layout"
import { type EmailDefinition, type EmailProps, type EmailTemplate, emailTemplates } from "./templates"

export type EmailLocale = "fa" | "tr" | "en"
export type RenderedEmail = { subject: string; html: string; text: string }

// Typed by the Turkish file, so a key missing in fa or en fails the type check.
const messages: Record<EmailLocale, typeof tr> = { fa, tr, en }

/**
 * Render a template in a language: validates the props (throws a ZodError on
 * bad input, e.g. a link that is not on this site), then builds the subject,
 * the HTML and the plain-text version. Brand name from the `brand` setting.
 */
export async function renderEmail<T extends EmailTemplate>(
  template: T,
  props: EmailProps<T>,
  locale: EmailLocale,
): Promise<RenderedEmail> {
  const def = emailTemplates[template] as unknown as EmailDefinition
  const p = def.schema.parse(props) as Record<string, string | number | undefined>
  const brand = await getBrand(locale)
  const t = createTranslator({
    locale,
    messages: messages[locale],
    // A missing message or value is a bug: fail loudly instead of sending "emails.x.y".
    onError: (error) => {
      throw error
    },
  })
  type Key = Parameters<typeof t>[0]
  const values = { ...p, ...def.values?.(p), brand }
  const msg = (key: string) => t(`${template}.${key}` as Key, values)
  const optional = (key: string) => (t.has(`${template}.${key}` as Key) ? msg(key) : undefined)
  const home = new URL(`/${locale}`, env.APP_URL).href

  const details = Object.entries(def.details ?? {}).flatMap(([label, key]) => {
    const value = p[key as string]
    if (value === undefined || value === "") return []
    return [{ label: t(`details.${label}` as Key), value: typeof value === "number" ? formatNumber(value, locale) : value }]
  })

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
      cta={{ label: msg("cta"), href: (p[def.cta] as string | undefined) ?? home }}
      note={optional("note")}
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
