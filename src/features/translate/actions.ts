"use server"

import { adminAction, UserError } from "@/lib/action"
import { encrypt } from "@/lib/crypto"
import { getSetting, setSetting } from "@/lib/settings"
import { translationSettingsSchema, translateSchema } from "./schema"
import { translate } from "./translate"

/** The "Translate" button: the text in the other languages wanted. */
export const translateTextAction = adminAction(translateSchema, async ({ text, from, to }) => translate(text, from, to))

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
