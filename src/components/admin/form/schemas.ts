/**
 * Zod building blocks that match the admin form components. Shared by the
 * client form (instant feedback) and the server action (the real check).
 * Error messages are message keys or come from `zodIssueMessage`.
 */
import { z } from "zod"

import type { Locale, LocalizedText } from "@/db/schema"

const LOCALES = ["fa", "tr", "en"] as const

/**
 * A `LocalizedText` value from <LocalizedInput>: { fa, tr, en }. Locales in
 * `required` must be filled; empty optional ones are dropped from the output.
 */
export function localizedText({ required = [], max = 200 }: { required?: readonly Locale[]; max?: number } = {}) {
  const field = (l: Locale) =>
    required.includes(l) ? z.string().trim().min(1).max(max) : z.string().trim().max(max).optional()
  return z
    .object({ fa: field("fa"), tr: field("tr"), en: field("en") })
    .transform((v): LocalizedText => {
      const out: LocalizedText = {}
      for (const l of LOCALES) if (v[l]) out[l] = v[l]
      return out
    })
}

/** An amount in kuruş from <MoneyInput>. Add `.nullable()` when optional. */
export function kurus({ min = 0, max = 100_000_000_00 }: { min?: number; max?: number } = {}) {
  return z.number().int().min(min).max(max)
}

/** An ISO timestamp from <DateTimeFields>, parsed to a Date. */
export function isoDateTime() {
  return z.iso.datetime({ offset: true }).transform((s) => new Date(s))
}

/** A URL slug: lower-case letters, digits and single hyphens. */
export function slug({ max = 80 }: { max?: number } = {}) {
  return z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(max)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: "common.validation.slug" })
}

/** A record id from the URL or a hidden field. */
export const uuid = () => z.uuid({ error: "common.errors.notFound" })
