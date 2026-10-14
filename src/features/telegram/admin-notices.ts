import "server-only"
import { randomBytes } from "node:crypto"
import { and, asc, desc, eq } from "drizzle-orm"
import { getTranslations } from "next-intl/server"

import { db } from "@/db"
import { admins, courses, ledgerTransactions, members, registrations, telegramNotices } from "@/db/schema"
import { paymentMethods, type PaymentMethod } from "@/features/registrations/admin/schema"
import { sendPaymentReceived } from "@/features/registrations/admin/notify"
import { recordPayment } from "@/features/registrations/admin/payments"
import { registrationDay } from "@/features/workshops/days"
import { absoluteLocaleUrl } from "@/i18n/links"
import { audit } from "@/lib/audit"
import { env } from "@/lib/env"
import { errorForLog, UserError } from "@/lib/errors"
import { formatDate, formatDateTime, formatTimeRange, localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { getSetting, setSetting } from "@/lib/settings"
import { publicUrls } from "@/lib/storage"
import { call, escape, telegramToken } from "./telegram"

/**
 * The admins' Telegram: when someone registers for a workshop or sends a bank
 * transfer receipt, the bot sends the admins listed in Settings → Telegram
 * (each once they pressed Start in the bot) a card with the workshop, the
 * participant and the person who registered, the amount and how they pay,
 * and the receipt itself, with "✅ Confirm payment". Confirming there (or in
 * the panel) records the payment like the panel does and updates every copy
 * of the card in every admin's chat. Nothing here ever throws to the caller:
 * a Telegram problem is logged, the site goes on.
 */

type Kind = "registration" | "receipt"
type Locale = "fa" | "tr" | "en"
const PAY = "pay:"
const RULE = "━━━━━━━━━━━━━━"

/** Telegram fetches a photo by its URL: it must be absolute (the local storage gives "/media/…"). */
const absolute = (url: string) => (url.startsWith("/") ? new URL(url, env.APP_URL).href : url)
/** Telegram refuses buttons to http or localhost links. */
const linkable = (url: string) => url.startsWith("https://") && !/^https:\/\/(localhost|127\.)/.test(url)
/** Isolated, so "12:00–15:00" or an email keeps its order inside a right-to-left line. */
const iso = (text: string) => `⁨${escape(text)}⁩`

/** Everything a card shows about one registration, or null when it is gone. */
async function load(registrationId: string) {
  const [row] = await db
    .select({
      id: registrations.id,
      status: registrations.status,
      amount: registrations.amount,
      participantName: registrations.participantName,
      paymentChoice: registrations.paymentChoice,
      paidAt: registrations.paidAt,
      day: registrations.day,
      receiptPath: registrations.receiptPath,
      createdAt: registrations.createdAt,
      member: { name: members.name, email: members.email, phone: members.phone },
      course: { id: courses.id, title: courses.title, startsAt: courses.startsAt, endsAt: courses.endsAt, days: courses.days },
    })
    .from(registrations)
    .innerJoin(members, eq(members.id, registrations.memberId))
    .innerJoin(courses, eq(courses.id, registrations.courseId))
    .where(eq(registrations.id, registrationId))
  if (!row) return null
  // Who confirmed the payment (the ledger entry's author), for the card's last line.
  const [payment] = await db
    .select({ by: admins.name })
    .from(ledgerTransactions)
    .leftJoin(admins, eq(admins.id, ledgerTransactions.createdBy))
    .where(and(eq(ledgerTransactions.registrationId, registrationId), eq(ledgerTransactions.kind, "registration_payment")))
    .orderBy(desc(ledgerTransactions.createdAt))
    .limit(1)
  return { ...row, paidBy: payment?.by ?? null }
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>

/** The card: its text (HTML) and buttons, in the admins' language, as the registration stands now. */
async function card(r: Loaded, kind: Kind, locale: Locale) {
  const t = await getTranslations({ locale, namespace: "telegram.admin" })
  const day = registrationDay(r.course, r.day)
  const pending = r.status === "pending" && r.amount > 0
  const way = r.paymentChoice && (paymentMethods as readonly string[]).includes(r.paymentChoice) ? t(`ways.${r.paymentChoice}`) : null
  const status =
    r.status === "cancelled"
      ? `❌ ${escape(t("status.cancelled"))}`
      : r.amount <= 0
        ? `🎁 ${escape(t("status.free"))}`
        : r.status === "confirmed"
          ? `✅ <b>${escape(t("status.paid"))}</b>${r.paidBy ? ` · ${escape(r.paidBy)}` : ""}${r.paidAt ? ` · ${iso(formatDateTime(r.paidAt, locale, "short"))}` : ""}`
          : kind === "receipt"
            ? `🔎 ${escape(t("status.check"))}`
            : `⏳ ${escape(t("status.pending"))}`
  const lines = [
    kind === "receipt" ? `🧾 <b>${escape(t("title.receipt"))}</b>` : `🎟 <b>${escape(t("title.registration"))}</b>`,
    RULE,
    `🎨 <b>${escape(localized(r.course.title, locale))}</b>`,
    `🗓 ${escape(formatDate(day.startsAt, locale, "full"))}`,
    `⏰ ${iso(formatTimeRange(day.startsAt, day.endsAt, locale))}`,
    RULE,
    `👤 ${escape(t("participant"))}: <b>${escape(r.participantName)}</b>`,
    ...(r.member.name.trim() !== r.participantName.trim() ? [`🙋 ${escape(t("registeredBy"))}: ${escape(r.member.name)}`] : []),
    `✉️ ${iso(r.member.email)}`,
    ...(r.member.phone ? [`📞 ${iso(r.member.phone)}`] : []),
    r.amount > 0 ? `💳 <b>${iso(formatLira(r.amount, locale))}</b>${way ? ` · ${escape(way)}` : ""}` : `💳 ${escape(t("free"))}`,
    RULE,
    status,
  ]
  const panel = await absoluteLocaleUrl(locale, `/admin/workshops/${r.course.id}/registrations`)
  const row = [
    ...(pending ? [{ text: `✅ ${t("confirm")}`, callback_data: `${PAY}${r.id}` }] : []),
    ...(linkable(panel) ? [{ text: `🔗 ${t("open")}`, url: panel }] : []),
  ]
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: row.length ? [row] : [] } }
}

/** The admins who get the cards now: listed, connected (pressed Start) and still active. */
async function recipients() {
  const setting = await getSetting("telegramAdmins")
  if (!setting.notify) return { setting, chats: [] as string[] }
  const active = await db.select({ id: admins.id }).from(admins).where(eq(admins.active, true))
  const ids = new Set(active.map((a) => a.id))
  const chats = setting.people.filter((p) => p.chatId && ids.has(p.adminId)).map((p) => p.chatId as string)
  return { setting, chats: [...new Set(chats)] }
}

/**
 * Send the card of a new registration (`kind` "registration") or of a receipt
 * just sent ("receipt", with the receipt as a photo or a PDF) to every admin
 * connected. Run after the response (`after`); never throws.
 */
export async function notifyAdmins(registrationId: string, kind: Kind): Promise<void> {
  try {
    const token = await telegramToken()
    if (!token) return
    const { setting, chats } = await recipients()
    if (!chats.length) return
    const r = await load(registrationId)
    if (!r) return
    const { text, reply_markup } = await card(r, kind, setting.locale)
    const file = kind === "receipt" && r.receiptPath ? (await publicUrls())(r.receiptPath) : null
    const pdf = Boolean(r.receiptPath?.toLowerCase().endsWith(".pdf"))
    for (const chatId of chats) {
      try {
        const sent = await send(token, chatId, text, reply_markup, file ? { url: absolute(file), pdf } : null)
        await db.insert(telegramNotices).values({ registrationId, kind, chatId, messageId: sent.messageId, format: sent.format })
      } catch (err) {
        console.error("[telegram] admin notice not sent", errorForLog(err))
      }
    }
  } catch (err) {
    console.error("[telegram] admin notices failed", errorForLog(err))
  }
}

/** One card to one chat: the receipt with the card as its caption, or the card alone (also when Telegram can't fetch the file). */
async function send(
  token: string,
  chatId: string,
  text: string,
  reply_markup: object,
  file: { url: string; pdf: boolean } | null,
): Promise<{ messageId: number; format: "text" | "photo" | "document" }> {
  if (file) {
    try {
      const method = file.pdf ? "sendDocument" : "sendPhoto"
      const sent = await call<{ message_id: number }>(token, method, {
        chat_id: chatId,
        [file.pdf ? "document" : "photo"]: file.url,
        caption: text,
        parse_mode: "HTML",
        reply_markup,
      })
      return { messageId: sent.message_id, format: file.pdf ? "document" : "photo" }
    } catch (err) {
      console.error("[telegram] receipt file not sent, the card goes alone", errorForLog(err))
    }
  }
  const sent = await call<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup,
  })
  return { messageId: sent.message_id, format: "text" }
}

/**
 * Bring every card of a registration up to date (paid, by whom; cancelled):
 * after "Confirm payment" in Telegram or in the panel. Never throws.
 */
export async function refreshAdminNotices(registrationId: string): Promise<void> {
  try {
    const token = await telegramToken()
    if (!token) return
    const notices = await db.select().from(telegramNotices).where(eq(telegramNotices.registrationId, registrationId)).orderBy(asc(telegramNotices.createdAt))
    if (!notices.length) return
    const r = await load(registrationId)
    if (!r) return
    const { locale } = await getSetting("telegramAdmins")
    for (const n of notices) {
      const { text, reply_markup } = await card(r, n.kind === "receipt" ? "receipt" : "registration", locale)
      const target = { chat_id: n.chatId, message_id: n.messageId, parse_mode: "HTML", reply_markup }
      try {
        if (n.format === "text") await call(token, "editMessageText", { ...target, text, link_preview_options: { is_disabled: true } })
        else await call(token, "editMessageCaption", { ...target, caption: text })
      } catch (err) {
        // "message is not modified" (already up to date) or deleted by the admin: nothing to do.
        if (!(err instanceof UserError)) console.error("[telegram] card not updated", errorForLog(err))
      }
    }
  } catch (err) {
    console.error("[telegram] cards not refreshed", errorForLog(err))
  }
}

// ─── The bot's side: Start and "Confirm payment" ─────────────────────────────

type Update = {
  message?: { chat: { id: number; type: string }; from?: { id: number; username?: string; first_name?: string }; text?: string }
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { chat: { id: number } } }
}

const handle = (username: string) => username.replace(/^@/, "").toLowerCase()

/**
 * An update from Telegram (the webhook, already checked to be Telegram's):
 * "/start" from a listed admin connects their chat; "Confirm payment" from a
 * connected admin records the payment as theirs.
 */
export async function handleTelegramUpdate(update: Update): Promise<void> {
  const token = await telegramToken()
  if (!token) return
  const setting = await getSetting("telegramAdmins")
  const t = await getTranslations({ locale: setting.locale, namespace: "telegram.admin" })

  const message = update.message
  if (message?.text?.startsWith("/start") && message.chat.type === "private" && message.from) {
    const who = message.from.username ? handle(message.from.username) : ""
    const person = who ? setting.people.find((p) => handle(p.username) === who) : undefined
    if (!person) {
      await call(token, "sendMessage", { chat_id: message.chat.id, text: t("start.unknown") }).catch(() => {})
      return
    }
    const chatId = String(message.chat.id)
    if (person.chatId !== chatId) {
      const people = setting.people.map((p) => (p.adminId === person.adminId ? { ...p, chatId } : p))
      await setSetting("telegramAdmins", { ...setting, people })
    }
    const [admin] = await db.select({ name: admins.name }).from(admins).where(eq(admins.id, person.adminId))
    await call(token, "sendMessage", { chat_id: message.chat.id, text: t("start.connected", { name: admin?.name ?? message.from.first_name ?? "" }) }).catch(() => {})
    return
  }

  const query = update.callback_query
  if (!query?.data?.startsWith(PAY)) return
  const answer = (text: string, alert = false) => call(token, "answerCallbackQuery", { callback_query_id: query.id, text, show_alert: alert }).catch(() => {})
  const registrationId = query.data.slice(PAY.length)
  const person = setting.people.find((p) => p.chatId === String(query.from.id))
  const [admin] = person ? await db.select({ id: admins.id, active: admins.active }).from(admins).where(eq(admins.id, person.adminId)) : []
  if (!admin?.active || !/^[0-9a-f-]{36}$/.test(registrationId)) {
    await answer(t("notAllowed"), true)
    return
  }
  try {
    const method = await confirmPayment(registrationId, admin.id)
    await answer(`✅ ${t("confirmed")}`)
    await sendPaymentReceived(registrationId, method).catch((err) => console.error("[telegram] payment email", errorForLog(err)))
  } catch (err) {
    if (!(err instanceof UserError)) throw err
    const all = await getTranslations({ locale: setting.locale })
    await answer((all as unknown as (key: string, values?: object) => string)(err.key, err.values), true)
  }
  await refreshAdminNotices(registrationId)
}

/** "Confirm payment" in Telegram: the payment is recorded now, the way they chose (a transfer when unknown), audited as that admin's. */
export async function confirmPayment(registrationId: string, adminId: string): Promise<PaymentMethod> {
  return db.transaction(async (tx) => {
    const [reg] = await tx
      .select({ amount: registrations.amount, paymentChoice: registrations.paymentChoice })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
    if (!reg) throw new UserError("workshops.registrations.errors.notFound")
    const method: PaymentMethod = (paymentMethods as readonly string[]).includes(reg.paymentChoice ?? "")
      ? (reg.paymentChoice as PaymentMethod)
      : "transfer"
    const paid = await recordPayment(tx, { registrationId, method, amount: reg.amount, paidAt: new Date(), createdBy: adminId })
    await audit(
      {
        adminId,
        action: "registration.payment",
        entity: "registration",
        entityId: registrationId,
        data: { courseId: paid.courseId, method, amount: paid.amount, transactionId: paid.transactionId, via: "telegram" },
      },
      tx,
    )
    return method
  })
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Telegram accepts a webhook only on https; the secret it sends back proves an update is its own. */
export const webhookUrl = () => new URL("/api/telegram/webhook", env.APP_URL).href
export const newWebhookSecret = () => randomBytes(24).toString("base64url")

/** Point the bot at this site (Settings → Telegram → Admins, on save); returns the bot's @username. */
export async function connectBot(token: string, secret: string): Promise<string> {
  const me = await call<{ username?: string }>(token, "getMe", {})
  const url = webhookUrl()
  if (url.startsWith("https://")) {
    await call(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"] })
  }
  return me.username ?? ""
}

/** "Send a test" to every connected admin; returns how many got it. */
export async function sendAdminTest(): Promise<number> {
  const token = await telegramToken()
  if (!token) throw new UserError("settings.telegram.errors.notSet")
  const { setting, chats } = await recipients()
  const t = await getTranslations({ locale: setting.locale, namespace: "telegram.admin" })
  let sent = 0
  for (const chatId of chats) {
    await call(token, "sendMessage", { chat_id: chatId, text: t("test") })
    sent += 1
  }
  return sent
}
