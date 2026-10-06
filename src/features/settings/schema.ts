/**
 * Form schemas of the settings pages, shared by the forms (client) and the
 * actions (server). They are as strict as, or stricter than, the stored
 * schemas in lib/settings.ts, which stay the source of truth: every value is
 * checked against those again when it is written.
 */
import { z } from "zod"

import { localizedText } from "@/components/admin/form/schemas"
import { isSafePath } from "@/lib/storage/shared"

export const siteLocales = ["fa", "tr", "en"] as const

/** Public-site themes (src/themes/<name>). A new theme is added to this list. */
export const themes = ["default"] as const

export const generalSettingsSchema = z.object({
  brand: localizedText({ required: siteLocales, max: 60 }),
  defaultLocale: z.enum(siteLocales),
  seo: z.object({
    title: localizedText({ max: 120 }),
    description: localizedText({ max: 300 }),
  }),
  theme: z.enum(themes),
})

export type GeneralSettingsValues = z.input<typeof generalSettingsSchema>

// ─── CDN ──────────────────────────────────────────────────────────────────────

export const cdnProviders = ["local", "bunny", "cloudflare"] as const
export type CdnProvider = (typeof cdnProviders)[number]

/** Key fields per provider. They are stored encrypted (`<field>Enc`) and never sent back to the browser. */
export const cdnSecretFields = {
  local: [],
  bunny: ["publicZoneKey", "privateZoneKey"],
  cloudflare: ["accessKeyId", "secretAccessKey"],
} as const satisfies Record<CdnProvider, readonly string[]>

/** A public hostname (no IP address, no port, no "localhost"). */
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
/** A Bunny storage zone or an R2 bucket name. */
const BUCKET = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

const text = () => z.string().trim().toLowerCase().min(1)
const host = text().max(253).regex(HOST, { error: "settings.storage.errors.host" })
const bucket = text().max(63).regex(BUCKET, { error: "settings.storage.errors.bucket" })
/** Empty means "keep the saved key". */
const secret = z.string().trim().max(256).regex(/^\S*$/, { error: "settings.storage.errors.key" })

export const cdnSettingsSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("local") }),
  z
    .object({
      provider: z.literal("bunny"),
      // Only Bunny's own storage endpoints (e.g. storage.bunnycdn.com, uk.storage.bunnycdn.com).
      storageHost: text().regex(/^(?:[a-z0-9-]+\.)?storage\.bunnycdn\.com$/, { error: "settings.storage.errors.bunnyHost" }),
      publicZone: bucket,
      publicZoneKey: secret,
      publicHost: host,
      privateZone: bucket,
      privateZoneKey: secret,
    })
    .refine((v) => v.publicZone !== v.privateZone, { path: ["privateZone"], error: "settings.storage.errors.sameZone" }),
  z
    .object({
      provider: z.literal("cloudflare"),
      accountId: text().regex(/^[a-f0-9]{32}$/, { error: "settings.storage.errors.accountId" }),
      accessKeyId: secret,
      secretAccessKey: secret,
      publicBucket: bucket,
      publicHost: host,
      privateBucket: bucket,
    })
    .refine((v) => v.publicBucket !== v.privateBucket, { path: ["privateBucket"], error: "settings.storage.errors.sameZone" }),
])

export type CdnSettingsInput = z.input<typeof cdnSettingsSchema>

/** What the storage page knows about the saved setting: every field except keys, and which keys are saved. */
export type CdnView = { provider: CdnProvider; values: Record<string, string>; saved: string[] }

// ─── Watermark ───────────────────────────────────────────────────────────────

export const watermarkPositions = [
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
  "tiled",
] as const
export type WatermarkPosition = (typeof watermarkPositions)[number]

/** Same ranges as the stored setting. */
export const watermarkRange = {
  sizePct: { min: 5, max: 60, step: 1 },
  opacity: { min: 0.1, max: 1, step: 0.05 },
  marginPct: { min: 0, max: 20, step: 0.5 },
} as const

/** The watermark logo is uploaded with purpose "watermark_logo": a PNG under brand/ in private storage. */
export const isLogoPath = (path: string) => isSafePath(path) && path.startsWith("brand/") && path.endsWith(".png")

const range = (r: { min: number; max: number }) => z.number().min(r.min).max(r.max)

/** Every gallery photo is watermarked: there is no on/off switch, uploads wait for a logo. */
export const watermarkSettingsSchema = z.object({
  logoPath: z.string().refine(isLogoPath, { error: "settings.watermark.errors.logo" }).nullable(),
  position: z.enum(watermarkPositions),
  sizePct: range(watermarkRange.sizePct),
  opacity: range(watermarkRange.opacity),
  marginPct: range(watermarkRange.marginPct),
})

export type WatermarkSettingsValues = z.input<typeof watermarkSettingsSchema>
