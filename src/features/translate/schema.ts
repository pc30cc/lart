import { z } from "zod"

import { locales } from "@/i18n/locales"

/** At most this many characters are translated at once (a long workshop description fits). */
export const TRANSLATE_MAX = 8000

/** Translate one text from `from` into each of `to` (the "Translate" button by a field in three languages). */
export const translateSchema = z.object({
  text: z.string().trim().min(1).max(TRANSLATE_MAX),
  from: z.enum(locales),
  to: z.array(z.enum(locales)).min(1).max(locales.length),
})
export type TranslateInput = z.input<typeof translateSchema>

/** On the signed-out instructor sign-up form: its longest field (the bio) fits. */
export const signupTranslateSchema = translateSchema.extend({ text: z.string().trim().min(1).max(1000) })

/** The cheap OpenAI models offered; the first is the default. */
export const translationModels = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano"] as const

/** Settings → General → Automatic translation. An empty key keeps the saved one; `removeKey` deletes it. */
export const translationSettingsSchema = z.object({
  openaiKey: z.string().trim().max(300).default(""),
  removeKey: z.boolean().default(false),
  model: z.enum(translationModels),
})
export type TranslationSettingsValues = z.input<typeof translationSettingsSchema>
