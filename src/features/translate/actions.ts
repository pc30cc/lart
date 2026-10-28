"use server"

import { adminAction, instructorAction, publicAction, UserError } from "@/lib/action"
import { createRateLimiter } from "@/lib/auth/rate-limit"
import { encrypt } from "@/lib/crypto"
import { getSetting, setSetting } from "@/lib/settings"
import { signupTranslateSchema, translationSettingsSchema, translateSchema } from "./schema"
import { translate } from "./translate"

const HOUR = 60 * 60_000
const LIMIT_MESSAGE = "settings.translation.errors.limit"

/** The "Translate" button in the admin panel: the text in the other languages wanted. */
export const translateTextAction = adminAction(translateSchema, async ({ text, from, to }) => translate(text, from, to), { duringMaintenance: true })

/** Per instructor, so one account cannot use up the shared translation quota. */
const instructorLimiter = createRateLimiter({ limit: 60, windowMs: HOUR })

/** The same button in the instructor panel (profile, documents). */
export const translateInstructorTextAction = instructorAction(translateSchema, async ({ text, from, to }, ctx) => {
  if (!instructorLimiter.consume(ctx.instructor.id).ok) throw new UserError(LIMIT_MESSAGE)
  return translate(text, from, to)
})

/** The button on the instructor sign-up form: signed out, so short texts and a limit per network. */
export const translateSignupTextAction = publicAction(signupTranslateSchema, async ({ text, from, to }) => translate(text, from, to), {
  rateLimit: { limit: 20, windowMs: HOUR },
  rateLimitMessage: LIMIT_MESSAGE,
})

/** Settings → General → Automatic translation: the OpenAI key (never shown again; empty keeps it) and the model. */
export const saveTranslationSettings = adminAction(translationSettingsSchema, async ({ openaiKey, removeKey, model }, ctx) => {
  const current = await getSetting("translation")
  if (openaiKey && !/^sk-[A-Za-z0-9_-]{20,}$/.test(openaiKey)) throw new UserError("settings.translation.errors.keyFormat", { field: "openaiKey" })
  const openaiKeyEnc = removeKey ? "" : openaiKey ? encrypt(openaiKey) : current.openaiKeyEnc
  await setSetting("translation", { openaiKeyEnc, model })
  // Which changed, never the key itself.
  await ctx.audit({ action: "settings.translation", entity: "setting", entityId: "translation", data: { model, keyReplaced: Boolean(openaiKey), keyRemoved: removeKey } })
  return { keySaved: Boolean(openaiKeyEnc) }
})
