import "server-only"
import { eq } from "drizzle-orm"
import { getTranslations } from "next-intl/server"

import { db } from "@/db"
import { courses, instructors } from "@/db/schema"
import { seatLimit } from "@/features/registrations/schema"
import { seatsLeft, seatsTaken } from "@/features/registrations/public"
import { absoluteLocaleUrl } from "@/i18n/links"
import { decrypt } from "@/lib/crypto"
import { UserError } from "@/lib/errors"
import { localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { getBrand, getSetting } from "@/lib/settings"
import { publicUrls } from "@/lib/storage"
import { formatWorkshopDates, workshopHours } from "@/features/workshops/days"

/** Telegram allows 1024 characters in a photo's caption. */
const CAPTION_MAX = 1024
const TIMEOUT_MS = 15_000

/** Text for Telegram's HTML: only &, < and > are special. */
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

type Config = { token: string; chatId: string; locale: "fa" | "tr" | "en" }

/** The saved bot and channel, or null when not set up. */
export async function telegramConfig(): Promise<Config | null> {
  const setting = await getSetting("telegram")
  if (!setting.botTokenEnc || !setting.chatId) return null
  return { token: decrypt(setting.botTokenEnc), chatId: setting.chatId, locale: setting.locale }
}

/** One Bot API call; a refusal becomes a UserError with Telegram's own reason (never the token). */
async function call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  let answer: Response
  try {
    answer = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new UserError("settings.telegram.errors.unreachable")
  }
  const data = (await answer.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
  if (!data?.ok) throw new UserError("settings.telegram.errors.refused", { values: { reason: (data?.description ?? String(answer.status)).slice(0, 200) } })
  return data.result as T
}

/** A short "it works" message to the channel (Settings → Telegram, "Send a test"). */
export async function sendTelegramTest(config: Config) {
  const t = await getTranslations({ locale: config.locale, namespace: "telegram" })
  await call(config.token, "sendMessage", { chat_id: config.chatId, text: t("test", { brand: await getBrand(config.locale) }) })
}

/** What the post says and shows, in the channel's language. */
export async function workshopPost(courseId: string, locale: "fa" | "tr" | "en") {
  const [row] = await db
    .select({ course: courses, instructor: { displayName: instructors.displayName } })
    .from(courses)
    .innerJoin(instructors, eq(instructors.id, courses.instructorId))
    .where(eq(courses.id, courseId))
  if (!row) return null
  const c = row.course
  const [t, brand, url, taken] = await Promise.all([
    getTranslations({ locale, namespace: "telegram" }),
    getBrand(locale),
    publicUrls(),
    seatsTaken(c.id),
  ])
  const title = localized(c.title, locale)
  const left = seatsLeft(seatLimit(c), taken)
  const lines = [
    `✨ <b>${escape(title)}</b> ✨`,
    "",
    "INTRO",
    `🗓  ${escape(formatWorkshopDates(c, locale, "full"))}`,
    // Isolated: "14:00–17:00" keeps its order in a right-to-left line.
    `⏰  \u2068${escape(workshopHours(c, locale))}\u2069`,
    `📍  ${escape(localized(c.venue, locale))}`,
    `🎨  ${escape(t("instructor", { name: localized(row.instructor.displayName, locale) }))}`,
    `💳  ${escape(c.price > 0 ? t("price", { price: formatLira(c.price, locale) }) : t("free"))}`,
    `👥  ${escape(left > 0 ? t("seats", { count: left }) : t("full"))}`,
    "",
    `🌿 <i>${escape(t("signoff", { brand }))}</i>`,
  ]
  // The introduction fills what the caption has left, cut at a word.
  const room = CAPTION_MAX - lines.join("\n").length - 20
  let intro = localized(c.intro, locale).replace(/\s+/g, " ").trim()
  if (intro.length > room) intro = `${intro.slice(0, Math.max(0, room)).replace(/\s+\S*$/, "")}…`
  const caption = lines
    .flatMap((line) => (line === "INTRO" ? (intro ? [`<i>${escape(intro)}</i>`, ""] : []) : [line]))
    .join("\n")
  return {
    caption,
    photoUrl: url(c.coverPath),
    link: await absoluteLocaleUrl(locale, `/workshops/${c.slug}`),
    button: t("register"),
    public: c.publishedAt !== null && (c.status === "published" || c.status === "confirmed"),
  }
}

/** Send the workshop to the channel: its cover with the caption and a "Register" button (text only without a cover). */
export async function postWorkshop(courseId: string): Promise<{ messageId: number }> {
  const config = await telegramConfig()
  if (!config) throw new UserError("settings.telegram.errors.notSet")
  const post = await workshopPost(courseId, config.locale)
  if (!post) throw new UserError("workshops.errors.notFound")
  if (!post.public) throw new UserError("workshops.telegram.notPublicError")
  const reply_markup = { inline_keyboard: [[{ text: post.button, url: post.link }]] }
  const message = post.photoUrl
    ? await call<{ message_id: number }>(config.token, "sendPhoto", {
        chat_id: config.chatId,
        photo: post.photoUrl,
        caption: post.caption,
        parse_mode: "HTML",
        reply_markup,
      })
    : await call<{ message_id: number }>(config.token, "sendMessage", {
        chat_id: config.chatId,
        text: post.caption,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup,
      })
  return { messageId: message.message_id }
}
