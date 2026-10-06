import "server-only"
import { eq, sql } from "drizzle-orm"
import { cache } from "react"
import { z } from "zod"

import { db, type Tx } from "@/db"
import { settings } from "@/db/schema"

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
  watermark: z.object({
    enabled: z.boolean(),
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
    enabled: true,
    logoPath: null,
    position: "bottom-right",
    sizePct: 18,
    opacity: 0.7,
    marginPct: 3,
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
