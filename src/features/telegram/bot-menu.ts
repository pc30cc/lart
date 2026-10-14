import "server-only"
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm"
import { getTranslations } from "next-intl/server"

import { db } from "@/db"
import { courses, members, registrations } from "@/db/schema"
import { formatWorkshopDates, registrationDay, workshopDays, workshopHours } from "@/features/workshops/days"
import { formatDate, formatNumber, localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { escape } from "./telegram"

/**
 * The admins' bot menu: "🎨 Workshops running" lists the workshops not over
 * yet; one opens with its numbers and two lists: the registrations paid, and
 * the cash payments still to collect, each with "✅ Paid" for when the money
 * is brought to the workshop (recorded by `confirmPayment`, in admin-notices).
 * Each screen is a text and its inline buttons; a button edits the message.
 */

type Locale = "fa" | "tr" | "en"
type Screen = { text: string; reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } }

export const MENU = { list: "list", workshop: "ws:", paid: "paid:", cash: "cash:", cashPay: "cpay:" } as const
const RULE = "━━━━━━━━━━━━━━"
const iso = (text: string) => `⁨${escape(text)}⁩`
const isId = (id: string) => /^[0-9a-f-]{36}$/.test(id)

/** The keyboard under the chat: always one tap from the workshops. */
export async function menuKeyboard(locale: Locale) {
  const t = await getTranslations({ locale, namespace: "telegram.admin.menu" })
  return { keyboard: [[{ text: t("button") }]], resize_keyboard: true, is_persistent: true }
}

/** Whether a message is the menu's button (in any of the languages, so a language change keeps it working). */
export async function isMenuButton(text: string) {
  for (const locale of ["fa", "tr", "en"] as const) {
    const t = await getTranslations({ locale, namespace: "telegram.admin.menu" })
    if (text.trim() === t("button")) return true
  }
  return text.trim() === "/menu" || text.trim() === "/workshops"
}

/** Workshops listed (published or confirmed) and not over yet, soonest first. */
export async function workshopsScreen(locale: Locale, now = new Date()): Promise<Screen> {
  const t = await getTranslations({ locale, namespace: "telegram.admin.menu" })
  const rows = await db
    .select({ id: courses.id, title: courses.title, startsAt: courses.startsAt, endsAt: courses.endsAt, days: courses.days })
    .from(courses)
    .where(and(inArray(courses.status, ["published", "confirmed"]), gt(courses.endsAt, now), isNull(courses.cancelledAt)))
    .orderBy(asc(courses.startsAt))
    .limit(30)
  const text = [`🎨 <b>${escape(t("workshopsTitle"))}</b>`, "", escape(rows.length ? t("choose") : t("none"))].join("\n")
  return {
    text,
    reply_markup: {
      inline_keyboard: rows.map((c) => [
        {
          text: `${c.startsAt <= now ? "🟢" : "🗓"} ${localized(c.title, locale)} · ${formatDate(c.startsAt, locale, "medium")}`.slice(0, 64),
          callback_data: `${MENU.workshop}${c.id}`,
        },
      ]),
    },
  }
}

/** The workshop's registrations still active, with who registered. */
async function activeRegistrations(courseId: string) {
  return db
    .select({
      id: registrations.id,
      participantName: registrations.participantName,
      status: registrations.status,
      amount: registrations.amount,
      paymentChoice: registrations.paymentChoice,
      paymentMethod: registrations.paymentMethod,
      day: registrations.day,
      memberName: members.name,
      phone: members.phone,
    })
    .from(registrations)
    .innerJoin(members, eq(members.id, registrations.memberId))
    .where(and(eq(registrations.courseId, courseId), inArray(registrations.status, ["pending", "confirmed"])))
    .orderBy(asc(registrations.createdAt))
}

async function course(courseId: string) {
  if (!isId(courseId)) return null
  const [c] = await db
    .select({ id: courses.id, title: courses.title, startsAt: courses.startsAt, endsAt: courses.endsAt, days: courses.days })
    .from(courses)
    .where(eq(courses.id, courseId))
  return c ?? null
}

/** Cash still to collect: not paid yet, something to pay, and cash chosen (or no way chosen). */
const owesCash = (r: Awaited<ReturnType<typeof activeRegistrations>>[number]) =>
  r.status === "pending" && r.amount > 0 && (r.paymentChoice === "cash" || r.paymentChoice === null)

/** One workshop: when, how many registered, paid, and cash to collect; the two lists. */
export async function workshopScreen(courseId: string, locale: Locale): Promise<Screen | null> {
  const c = await course(courseId)
  if (!c) return null
  const t = await getTranslations({ locale, namespace: "telegram.admin.menu" })
  const regs = await activeRegistrations(c.id)
  const n = (v: number) => formatNumber(v, locale)
  const paid = regs.filter((r) => r.status === "confirmed")
  const cash = regs.filter(owesCash)
  const unpaid = regs.filter((r) => r.status === "pending")
  const text = [
    `🎨 <b>${escape(localized(c.title, locale))}</b>`,
    `🗓 ${escape(formatWorkshopDates(c, locale, "full"))}`,
    `⏰ ${iso(workshopHours(c, locale))}`,
    RULE,
    `👥 ${escape(t("registered", { n: n(regs.length) }))}`,
    `✅ ${escape(t("paidCount", { n: n(paid.length) }))}`,
    `⏳ ${escape(t("unpaidCount", { n: n(unpaid.length) }))}`,
    `💵 ${escape(t("cashCount", { n: n(cash.length), sum: formatLira(cash.reduce((s, r) => s + r.amount, 0), locale) }))}`,
  ].join("\n")
  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: `✅ ${t("paidButton")} (${n(paid.length)})`, callback_data: `${MENU.paid}${c.id}` },
          { text: `💵 ${t("cashButton")} (${n(cash.length)})`, callback_data: `${MENU.cash}${c.id}` },
        ],
        [{ text: `↩️ ${t("back")}`, callback_data: MENU.list }],
      ],
    },
  }
}

/** A line of a list: "3. Arin · ₺4,500 · Cash", with the day on a workshop of several days. */
function line(
  r: Awaited<ReturnType<typeof activeRegistrations>>[number],
  i: number,
  c: NonNullable<Awaited<ReturnType<typeof course>>>,
  locale: Locale,
  t: (key: string) => string,
) {
  const several = workshopDays(c).length > 1
  const way = r.paymentMethod ?? r.paymentChoice
  const parts = [
    `${formatNumber(i + 1, locale)}. <b>${escape(r.participantName)}</b>`,
    ...(r.memberName.trim() !== r.participantName.trim() ? [escape(r.memberName)] : []),
    r.amount > 0 ? iso(formatLira(r.amount, locale)) : escape(t("free")),
    ...(way ? [escape(t(`ways.${way}`))] : []),
    ...(several ? [escape(formatDate(registrationDay(c, r.day).startsAt, locale, "medium"))] : []),
  ]
  return parts.join(" · ") + (r.phone ? `\n     📞 ${iso(r.phone)}` : "")
}

/** The registrations paid (or free). */
export async function paidScreen(courseId: string, locale: Locale): Promise<Screen | null> {
  const c = await course(courseId)
  if (!c) return null
  const [t, ta] = await Promise.all([
    getTranslations({ locale, namespace: "telegram.admin.menu" }),
    getTranslations({ locale, namespace: "telegram.admin" }),
  ])
  const paid = (await activeRegistrations(c.id)).filter((r) => r.status === "confirmed")
  const total = paid.reduce((s, r) => s + r.amount, 0)
  const text = [
    `✅ <b>${escape(t("paidTitle"))}</b>`,
    `🎨 ${escape(localized(c.title, locale))}`,
    RULE,
    ...(paid.length ? paid.map((r, i) => line(r, i, c, locale, ta)) : [escape(t("nonePaid"))]),
    ...(paid.length ? [RULE, `💰 ${escape(t("total"))}: <b>${iso(formatLira(total, locale))}</b>`] : []),
  ].join("\n")
  return { text: text.slice(0, 4000), reply_markup: { inline_keyboard: [[{ text: `↩️ ${t("backToWorkshop")}`, callback_data: `${MENU.workshop}${c.id}` }]] } }
}

/** The cash still to collect, each with "✅ Paid · name". */
export async function cashScreen(courseId: string, locale: Locale): Promise<Screen | null> {
  const c = await course(courseId)
  if (!c) return null
  const [t, ta] = await Promise.all([
    getTranslations({ locale, namespace: "telegram.admin.menu" }),
    getTranslations({ locale, namespace: "telegram.admin" }),
  ])
  const cash = (await activeRegistrations(c.id)).filter(owesCash)
  const text = [
    `💵 <b>${escape(t("cashTitle"))}</b>`,
    `🎨 ${escape(localized(c.title, locale))}`,
    RULE,
    ...(cash.length ? cash.map((r, i) => line(r, i, c, locale, ta)) : [escape(t("noneCash"))]),
    ...(cash.length ? [RULE, escape(t("cashHint"))] : []),
  ].join("\n")
  return {
    text: text.slice(0, 4000),
    reply_markup: {
      inline_keyboard: [
        ...cash.slice(0, 40).map((r) => [
          { text: `✅ ${t("markPaid")} · ${r.participantName} · ${formatLira(r.amount, locale)}`.slice(0, 64), callback_data: `${MENU.cashPay}${r.id}` },
        ]),
        [{ text: `↩️ ${t("backToWorkshop")}`, callback_data: `${MENU.workshop}${c.id}` }],
      ],
    },
  }
}

/** The workshop a registration belongs to (to show its cash list again after "Paid"). */
export async function courseOf(registrationId: string) {
  if (!isId(registrationId)) return null
  const [row] = await db.select({ courseId: registrations.courseId }).from(registrations).where(eq(registrations.id, registrationId))
  return row?.courseId ?? null
}
