import "server-only"

import type { AppLocale } from "@/i18n/locales"
import { decrypt } from "@/lib/crypto"
import { errorForLog, UserError } from "@/lib/errors"
import { getSetting } from "@/lib/settings"

/**
 * Machine translation for the admin's texts in three languages. With an
 * OpenAI key (Settings → General): one request to a cheap model for every
 * language wanted, told to keep the tone, line breaks, names, numbers and
 * emoji. Without one: the free MyMemory service (no key; shorter pieces,
 * plainer quality, a daily limit). Either way the admin reads it before saving.
 */

const NAMES: Record<AppLocale, string> = { fa: "Persian (Farsi)", tr: "Turkish", en: "English" }
const TIMEOUT_MS = 30_000

export async function translate(text: string, from: AppLocale, to: AppLocale[]): Promise<Partial<Record<AppLocale, string>>> {
  const wanted = to.filter((l) => l !== from)
  if (!wanted.length) return {}
  const setting = await getSetting("translation")
  const key = setting.openaiKeyEnc ? safeDecrypt(setting.openaiKeyEnc) : ""
  try {
    return key ? await withOpenAI(key, setting.model, text, from, wanted) : await withMyMemory(text, from, wanted)
  } catch (err) {
    if (err instanceof UserError) throw err
    console.error("[translate] failed", errorForLog(err))
    throw new UserError("settings.translation.errors.failed")
  }
}

function safeDecrypt(enc: string) {
  try {
    return decrypt(enc)
  } catch {
    return ""
  }
}

async function withOpenAI(key: string, model: string, text: string, from: AppLocale, to: AppLocale[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You translate texts of an art-workshop studio's website in Istanbul (workshop titles, descriptions, venues, notes). " +
            "Translate naturally and warmly, as a native speaker would write it for that website, not word for word. " +
            "Keep line breaks, lists, emoji, numbers, prices, dates, URLs and people's or brand names as they are. " +
            `Answer with a JSON object only, whose keys are ${to.map((l) => `"${l}"`).join(", ")} and whose values are the translations.`,
        },
        { role: "user", content: `Translate from ${NAMES[from]} into ${to.map((l) => NAMES[l]).join(", ")}:\n\n${text}` },
      ],
    }),
  })
  if (res.status === 401) throw new UserError("settings.translation.errors.badKey")
  if (res.status === 429) throw new UserError("settings.translation.errors.limit")
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>
  return Object.fromEntries(to.flatMap((l) => (typeof parsed[l] === "string" && parsed[l] ? [[l, (parsed[l] as string).trim()]] : [])))
}

/** MyMemory takes up to about 500 bytes a request: the text goes in pieces, by paragraph, then by sentence. */
const PIECE = 450

function pieces(text: string): string[] {
  const out: string[] = []
  for (const para of text.split(/(\n+)/)) {
    if (/^\n+$/.test(para) || new TextEncoder().encode(para).length <= PIECE) {
      out.push(para)
      continue
    }
    let current = ""
    for (const sentence of para.split(/(?<=[.!?؟。])\s+/)) {
      if (current && new TextEncoder().encode(`${current} ${sentence}`).length > PIECE) {
        out.push(current)
        current = sentence
      } else current = current ? `${current} ${sentence}` : sentence
    }
    if (current) out.push(current)
  }
  return out
}

async function withMyMemory(text: string, from: AppLocale, to: AppLocale[]) {
  const result: Partial<Record<AppLocale, string>> = {}
  for (const target of to) {
    const parts: string[] = []
    for (const piece of pieces(text)) {
      if (!piece.trim()) {
        parts.push(piece)
        continue
      }
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=${from}|${target}`
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.status === 429) throw new UserError("settings.translation.errors.limit")
      if (!res.ok) throw new Error(`mymemory ${res.status}`)
      const body = (await res.json()) as { responseStatus?: number | string; responseData?: { translatedText?: string } }
      if (Number(body.responseStatus) === 429) throw new UserError("settings.translation.errors.limit")
      if (Number(body.responseStatus) !== 200 || !body.responseData?.translatedText) throw new Error(`mymemory ${body.responseStatus}`)
      parts.push(body.responseData.translatedText)
    }
    result[target] = parts.join(" ").replace(/ (\n+) /g, "$1").trim()
  }
  return result
}
