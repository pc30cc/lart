import "server-only"
import { eq, sql } from "drizzle-orm"
import { cache } from "react"
import { z } from "zod"

import { db, type Tx } from "@/db"
import { settings } from "@/db/schema"
import { EMAIL_TEXT_MAX, emailTemplateNames, emailTextFields } from "@/emails/names"

/**
 * Typed site settings. Each key has a Zod schema and a default, so a missing
 * row never breaks the site. Provider keys are stored encrypted (lib/crypto).
 */

const localized = z.object({
  fa: z.string().trim().max(500).optional(),
  tr: z.string().trim().max(500).optional(),
  en: z.string().trim().max(500).optional(),
})

const locale = z.enum(["fa", "tr", "en"])

/** One email text in three languages; longer than `localized`. Empty means "use the bundled text". */
const emailText = z.object({
  fa: z.string().trim().max(EMAIL_TEXT_MAX).optional(),
  tr: z.string().trim().max(EMAIL_TEXT_MAX).optional(),
  en: z.string().trim().max(EMAIL_TEXT_MAX).optional(),
})

export const settingSchemas = {
  /** Brand name shown everywhere as {brand}. */
  brand: localized,
  /** Language of "/" and of emails when no language is known. */
  defaultLocale: locale,
  seo: z.object({ title: localized, description: localized }),
  /** Active public-site theme folder name (src/themes/<name>). */
  theme: z.string().regex(/^[a-z0-9-]+$/),
  /**
   * Where uploads go. `local` is for development only.
   * Public files are served by the CDN; originals (unwatermarked) go to a
   * separate private zone / bucket that has no public access.
   */
  cdn: z.discriminatedUnion("provider", [
    z.object({ provider: z.literal("local") }),
    z.object({
      provider: z.literal("bunny"),
      /** Storage API endpoint host, e.g. storage.bunnycdn.com or de.storage.bunnycdn.com. */
      storageHost: z.string().regex(/^[a-z0-9.-]+$/),
      publicZone: z.string().min(1),
      publicZoneKeyEnc: z.string().min(1),
      /** Pull-zone hostname serving the public zone, e.g. cdn.example.com. */
      publicHost: z.string().regex(/^[a-z0-9.-]+$/),
      privateZone: z.string().min(1),
      privateZoneKeyEnc: z.string().min(1),
    }),
    z.object({
      provider: z.literal("cloudflare"),
      accountId: z.string().regex(/^[a-f0-9]{32}$/),
      accessKeyIdEnc: z.string().min(1),
      secretAccessKeyEnc: z.string().min(1),
      publicBucket: z.string().min(1),
      /** Custom domain connected to the public bucket, e.g. cdn.example.com. */
      publicHost: z.string().regex(/^[a-z0-9.-]+$/),
      privateBucket: z.string().min(1),
    }),
  ]),
  /**
   * Every gallery photo is watermarked; uploads are refused until a logo is set.
   * Rows saved with the former `enabled` switch still parse (unknown keys are dropped).
   */
  watermark: z.object({
    /** Storage path of the PNG logo, or null when not uploaded yet. */
    logoPath: z.string().nullable(),
    position: z.enum([
      "top-left", "top", "top-right",
      "left", "center", "right",
      "bottom-left", "bottom", "bottom-right",
      "tiled",
    ]),
    /** Logo width as a percentage of the photo width. */
    sizePct: z.number().min(5).max(60),
    opacity: z.number().min(0.1).max(1),
    /** Distance from the edge as a percentage of the photo width. */
    marginPct: z.number().min(0).max(20),
  }),
  /**
   * The admin's own email texts (templates page): email → field → language,
   * laid over messages/<locale>/emails.json when an email is rendered.
   */
  emailTexts: z.partialRecord(z.enum(emailTemplateNames), z.partialRecord(z.enum(emailTextFields), emailText)),
  /**
   * How students pay for workshops (any combination). Payments are recorded by
   * admins in every case; automatic online confirmation comes in a later phase.
   */
  payment: z.object({
    /** Pay in cash at the workshop. */
    cash: z.boolean(),
    /** Pay by bank transfer to this account (shown to registered students). */
    transfer: z.object({
      enabled: z.boolean(),
      accountHolder: z.string().trim().max(120),
      bankName: z.string().trim().max(120),
      /** Turkish IBAN without spaces: TR + 24 digits (checksum verified by the form). */
      iban: z.string().regex(/^(TR\d{24})?$/),
      /** Extra instructions, e.g. "write the participant's name in the description". */
      note: localized,
    }),
    /** Pay online with the workshop's own payment link (courses.payment_url). */
    online: z.object({ enabled: z.boolean(), note: localized }),
  }),
  /**
   * How emails are sent: Resend (API) or any SMTP server (our own mail server,
   * or a service such as Brevo). Both configurations are kept, so switching
   * back and forth keeps what was entered. `env` (the default) means "use the
   * server's RESEND_API_KEY / EMAIL_FROM", as before this setting existed.
   * Keys and passwords are stored encrypted (lib/crypto).
   */
  email: z.object({
    provider: z.enum(["env", "resend", "smtp"]),
    /** The sender address; the display name is always the brand. Empty: EMAIL_FROM. */
    fromAddress: z.string().max(254),
    /** Where replies go. Empty: to the sender address. */
    replyTo: z.string().max(254),
    resendKeyEnc: z.string(),
    smtp: z.object({
      host: z.string().max(253),
      port: z.number().int().min(1).max(65535),
      /** tls: encrypted from the start (465); starttls: upgraded (587); none: only for a relay on the same server. */
      security: z.enum(["tls", "starttls", "none"]),
      user: z.string().max(254),
      passwordEnc: z.string(),
    }),
  }),
} as const

export type SettingKey = keyof typeof settingSchemas
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>

export const settingDefaults: { [K in SettingKey]: SettingValue<K> } = {
  brand: { fa: "لارت", tr: "Lart", en: "Lart" },
  defaultLocale: "tr",
  seo: { title: {}, description: {} },
  theme: "default",
  cdn: { provider: "local" },
  watermark: {
    logoPath: null,
    position: "bottom-right",
    sizePct: 18,
    opacity: 0.7,
    marginPct: 3,
  },
  emailTexts: {},
  payment: {
    cash: true,
    transfer: { enabled: false, accountHolder: "", bankName: "", iban: "", note: {} },
    online: { enabled: false, note: {} },
  },
  email: {
    provider: "env",
    fromAddress: "",
    replyTo: "",
    resendKeyEnc: "",
    smtp: { host: "", port: 587, security: "starttls", user: "", passwordEnc: "" },
  },
}

const loadAll = cache(async () => {
  const rows = await db.select().from(settings)
  return new Map(rows.map((r) => [r.key, r.value]))
})

/** Read a setting (cached per request). Invalid stored values fall back to the default. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const raw = (await loadAll()).get(key)
  if (raw === undefined) return settingDefaults[key]
  const parsed = settingSchemas[key].safeParse(raw)
  return parsed.success ? (parsed.data as SettingValue<K>) : settingDefaults[key]
}

/** Write a setting. Validates against its schema. */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  tx: Tx | typeof db = db,
): Promise<void> {
  const data = settingSchemas[key].parse(value)
  await tx
    .insert(settings)
    .values({ key, value: data })
    .onConflictDoUpdate({ target: settings.key, set: { value: data, updatedAt: sql`now()` } })
}

export async function deleteSetting(key: SettingKey, tx: Tx | typeof db = db) {
  await tx.delete(settings).where(eq(settings.key, key))
}

/** Brand name in a language, falling back to Turkish, then English. */
export async function getBrand(locale: string): Promise<string> {
  const brand = await getSetting("brand")
  return brand[locale as keyof typeof brand] || brand.tr || brand.en || "Lart"
}
