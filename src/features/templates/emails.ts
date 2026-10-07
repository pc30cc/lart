import "server-only"
import { getTranslations } from "next-intl/server"

import type { Locale, LocalizedText } from "@/db/schema"
import { defaultEmailTexts, type EmailLocale, type EmailTexts } from "@/emails"
import { emailTemplateNames, emailTextFields, type EmailTemplate, type EmailTextField } from "@/emails/names"
import { accountEmailSamples } from "@/emails/samples"
import { emailPlaceholders, type EmailProps } from "@/emails/templates"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatDateTime, formatTimeRange, zonedParts, zonedToIso } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { getSetting } from "@/lib/settings"

const LOCALES: Locale[] = ["fa", "tr", "en"]
const DAY = 86_400_000

export const isEmailTemplate = (name: string): name is EmailTemplate =>
  (emailTemplateNames as readonly string[]).includes(name)

/** Languages in which the admin changed at least one text of the email. */
function editedLanguages(texts: EmailTexts | undefined): Locale[] {
  return LOCALES.filter((l) => Object.values(texts ?? {}).some((text) => text?.[l]?.trim()))
}

/** The emails for the templates page, each with the languages whose texts were changed. */
export async function listEmails() {
  await requireAdmin()
  const saved = await getSetting("emailTexts")
  return emailTemplateNames.map((template) => ({ template, edited: editedLanguages(saved[template]) }))
}

export type EmailEditor = {
  template: EmailTemplate
  /** The bundled text of each field per language (shown when a field is left empty). */
  defaults: Record<EmailTextField, LocalizedText>
  /** The admin's texts, every field and language present ("" = default). */
  saved: Record<EmailTextField, { fa: string; tr: string; en: string }>
  edited: Locale[]
  placeholders: string[]
}

/** What the editor of one email needs. */
export async function getEmailEditor(template: EmailTemplate): Promise<EmailEditor> {
  await requireAdmin()
  const own = (await getSetting("emailTexts"))[template]
  const bundled = Object.fromEntries(LOCALES.map((l) => [l, defaultEmailTexts(template, l)])) as Record<Locale, Record<string, string>>
  const defaults = {} as EmailEditor["defaults"]
  const saved = {} as EmailEditor["saved"]
  for (const field of emailTextFields) {
    defaults[field] = Object.fromEntries(LOCALES.flatMap((l) => (bundled[l][field] ? [[l, bundled[l][field]]] : [])))
    saved[field] = { fa: own?.[field]?.fa ?? "", tr: own?.[field]?.tr ?? "", en: own?.[field]?.en ?? "" }
  }
  return { template, defaults, saved, edited: editedLanguages(own), placeholders: emailPlaceholders(template).names }
}

/**
 * Example props for the preview, formatted like the real emails: a workshop
 * two weeks from now, 14:00–17:00 Istanbul time. Links stay on this site,
 * except the example payment link. The phase 2 emails come from
 * `accountEmailSamples` (src/emails/samples.ts).
 */
export async function sampleEmailProps<T extends EmailTemplate>(template: T, locale: EmailLocale, adminName: string): Promise<EmailProps<T>> {
  const t = await getTranslations({ locale, namespace: "templates" })
  const day = zonedParts(Date.now() + 14 * DAY).date
  const startsAt = new Date(zonedToIso(day, "14:00")!)
  const endsAt = new Date(zonedToIso(day, "17:00")!)
  const person = t("emails.sample.person")
  const instructorName = t("preview.sample.instructorName")
  const workshopTitle = t("preview.sample.workshopTitle")
  const date = formatDate(startsAt, locale, "full")
  const time = formatTimeRange(startsAt, endsAt, locale)
  const workshopUrl = `/${locale}`
  const venue = t("preview.sample.venue")
  const amount = formatLira(150_000, locale)
  const account = accountEmailSamples({
    locale,
    person,
    adminName,
    workshopTitle,
    venue,
    date,
    time,
    amount,
    halfAmount: formatLira(75_000, locale),
  })
  const samples: { [K in EmailTemplate]: EmailProps<K> } = {
    welcome_verify: { name: person, verifyUrl: `/${locale}` },
    instructor_invite: { name: instructorName, acceptUrl: `/${locale}` },
    instructor_signup: {
      adminName,
      instructorName,
      teachingField: t("emails.sample.teachingField"),
      instructorEmail: "instructor@example.com",
      instructorUrl: `/${locale}/admin/instructors`,
    },
    instructor_approved: { name: instructorName, panelUrl: `/${locale}/instructor` },
    contract_ready: { instructorName, workshopTitle, workshopDate: `${date}${locale === "fa" ? "،" : ","} ${time}`, signUrl: `/${locale}` },
    contract_signed: { adminName, instructorName, workshopTitle, workshopUrl: `/${locale}/admin` },
    decision_due: {
      adminName,
      workshopTitle,
      registrations: 5,
      minimum: 4,
      decisionAt: formatDateTime(new Date(startsAt.getTime() - 3 * DAY), locale, "long"),
      workshopUrl: `/${locale}/admin`,
    },
    registration_confirmed: { name: person, workshopTitle, date, time, venue, amount, workshopUrl },
    // Not paid yet: shows the payment part too (the bundled texts leave it out once everything is paid).
    workshop_reminder: {
      name: person,
      workshopTitle,
      date,
      time,
      venue,
      bring: t("emails.sample.bring"),
      workshopUrl,
      amount,
      participantName: person,
      cash: true,
      transfer: account.registration_received.transfer,
      paymentUrl: account.registration_received.paymentUrl,
    },
    workshop_cancelled: { name: person, workshopTitle, refundAmount: amount, workshopsUrl: workshopUrl },
    password_reset: { name: person, resetUrl: `/${locale}` },
    ...account,
  }
  return samples[template]
}
