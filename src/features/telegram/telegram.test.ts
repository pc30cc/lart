import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { auditLog, courses, registrations, telegramNotices } from "@/db/schema"
import { addRegistration, makeAdmin, makeCourse, makeWorld } from "@/features/money/testing"
import { createAdmin, createCategory, createInstructor, createTermsTemplate, runId } from "@/features/workshops/test-fixtures"
import { encrypt } from "@/lib/crypto"
import { deleteSetting, getSetting, setSetting } from "@/lib/settings"
import { POST as webhook } from "@/app/api/telegram/webhook/route"
import { handleTelegramUpdate, notifyAdmins, refreshAdminNotices } from "./admin-notices"
import { telegramAdminsSchema, telegramSettingsSchema } from "./schema"
import { postWorkshop, workshopPost } from "./telegram"

const paymentEmail = vi.hoisted(() => vi.fn(async () => true))
vi.mock("@/features/registrations/admin/notify", async (original) => ({
  ...(await original<typeof import("@/features/registrations/admin/notify")>()),
  sendPaymentReceived: paymentEmail,
}))

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = { telegram: (await import("../../../messages/fa/telegram.json")).default }
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => createTranslator({ locale, messages, namespace: namespace as never }),
  }
})

const run = runId()
let courseId: string

beforeAll(async () => {
  const [admin, category, instructor, terms] = await Promise.all([createAdmin(run), createCategory(run), createInstructor(run), createTermsTemplate(run)])
  const start = Date.now() + 10 * 86_400_000
  const [course] = await db
    .insert(courses)
    .values({
      slug: `tg-${run}-${randomUUID().slice(0, 6)}`,
      status: "published",
      categoryId: category.id,
      instructorId: instructor.id,
      title: { fa: "شمع‌سازی <ویژه>", en: "Candle making" },
      intro: { fa: "یک عصر آرام با موم و رنگ. ".repeat(80) },
      venue: { fa: "استودیو لیمر" },
      startsAt: new Date(start),
      endsAt: new Date(start + 7_200_000),
      minCapacity: 1,
      maxCapacity: 8,
      price: 150_000,
      registrationDeadline: new Date(start - 86_400_000),
      decisionAt: new Date(start - 2 * 86_400_000),
      termsTemplateId: terms.id,
      publishedAt: new Date(),
      createdBy: admin.id,
    })
    .returning()
  courseId = course.id
})
afterAll(async () => {
  await deleteSetting("telegram")
  await deleteSetting("telegramAdmins")
  vi.unstubAllGlobals()
})

describe("telegram settings", () => {
  it("takes a bot token and a channel, or leaves them empty", () => {
    const ok = { botToken: "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345", chatId: "@limer_atolye", locale: "fa" }
    expect(telegramSettingsSchema.safeParse(ok).success).toBe(true)
    expect(telegramSettingsSchema.safeParse({ ...ok, chatId: "-1001234567890" }).success).toBe(true)
    expect(telegramSettingsSchema.safeParse({ ...ok, botToken: "" }).success).toBe(true)
    expect(telegramSettingsSchema.safeParse({ ...ok, botToken: "nope" }).success).toBe(false)
    expect(telegramSettingsSchema.safeParse({ ...ok, chatId: "limer" }).success).toBe(false)
  })
})

describe("the workshop's post", () => {
  it("fits Telegram's caption, with the details escaped and the intro cut at a word", async () => {
    const post = (await workshopPost(courseId, "fa"))!
    expect(post.caption.length).toBeLessThanOrEqual(1024)
    expect(post.caption).toContain("<b>شمع‌سازی &lt;ویژه&gt;</b>")
    expect(post.caption).toContain("📍  استودیو لیمر")
    expect(post.caption).toContain("…</i>")
    expect(post.link).toMatch(/\/workshops\/tg-/)
    expect(post.public).toBe(true)
  })

  it("is sent with the saved bot to the channel, with a Register button", async () => {
    await setSetting("telegram", { botTokenEnc: encrypt("123:token"), chatId: "@limer_atolye", locale: "fa" })
    const fetch = vi.fn(async () => Response.json({ ok: true, result: { message_id: 42 } }))
    vi.stubGlobal("fetch", fetch)
    expect(await postWorkshop(courseId)).toEqual({ messageId: 42 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    // No cover: a text message.
    expect(url).toBe("https://api.telegram.org/bot123:token/sendMessage")
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ chat_id: "@limer_atolye", parse_mode: "HTML" })
    expect(body.reply_markup.inline_keyboard[0][0].url).toMatch(/\/workshops\/tg-/)

    fetch.mockResolvedValueOnce(Response.json({ ok: false, description: "Forbidden: bot is not a member of the channel chat" }, { status: 403 }))
    await expect(postWorkshop(courseId)).rejects.toMatchObject({ key: "settings.telegram.errors.refused" })
  })

  it("is refused for a workshop that is not public", async () => {
    await db.update(courses).set({ status: "awaiting_signature", publishedAt: null }).where(eq(courses.id, courseId))
    await expect(postWorkshop(courseId)).rejects.toMatchObject({ key: "workshops.telegram.notPublicError" })
  })
})

describe("the admins' bot", () => {
  type Call = { method: string; body: Record<string, unknown> }
  const calls: Call[] = []
  const stub = () => {
    calls.length = 0
    let id = 100
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ method: url.split("/").pop()!, body: JSON.parse(String(init.body)) })
        return Response.json({ ok: true, result: { message_id: (id += 1), username: "limer_bot" } })
      }),
    )
  }
  const text = (c: Call) => String(c.body.text ?? c.body.caption ?? "")
  const buttons = (c: Call) => JSON.stringify(c.body.reply_markup ?? {})

  it("checks the usernames", () => {
    const base = { notify: true, locale: "fa", people: [{ adminId: randomUUID(), username: "@limer_mina" }] }
    expect(telegramAdminsSchema.safeParse(base).success).toBe(true)
    expect(telegramAdminsSchema.safeParse({ ...base, people: [{ adminId: randomUUID(), username: "" }] }).success).toBe(true)
    expect(telegramAdminsSchema.safeParse({ ...base, people: [{ adminId: randomUUID(), username: "ab" }] }).success).toBe(false)
  })

  it("sends a new registration to the connected admins, and Confirm payment records it as theirs and updates every card", async () => {
    const world = await makeWorld()
    const admin = await makeAdmin(`Mina ${run}`)
    const other = await makeAdmin(`Leyla ${run}`)
    const course = await makeCourse(world, admin.id, { status: "published" })
    const registrationId = await addRegistration(world, course, { status: "pending", amount: 450_000 })
    await db.update(registrations).set({ participantName: `Arin <${run}>`, paymentChoice: "transfer" }).where(eq(registrations.id, registrationId))
    await setSetting("telegram", { botTokenEnc: encrypt("123456789:AAH-abcdefghijklmnopqrstuvwxyz012345"), chatId: "", locale: "fa" })
    await setSetting("telegramAdmins", {
      notify: true,
      locale: "fa",
      secret: `s-${run}`,
      botUsername: "limer_bot",
      people: [
        { adminId: admin.id, username: "mina_tg", chatId: "111" },
        { adminId: other.id, username: "leyla_tg", chatId: "222" },
      ],
    })
    stub()

    await notifyAdmins(registrationId, "registration")
    expect(calls.map((c) => [c.method, c.body.chat_id])).toEqual([["sendMessage", "111"], ["sendMessage", "222"]])
    expect(text(calls[0])).toContain("ثبت‌نام تازه")
    expect(text(calls[0])).toContain(`Arin &lt;${run}&gt;`)
    expect(text(calls[0])).toContain("در انتظار پرداخت")
    expect(buttons(calls[0])).toContain(`pay:${registrationId}`)
    expect(await db.select().from(telegramNotices).where(eq(telegramNotices.registrationId, registrationId))).toHaveLength(2)

    // Someone not connected can't confirm.
    stub()
    await handleTelegramUpdate({ callback_query: { id: "q0", from: { id: 999 }, data: `pay:${registrationId}` } })
    expect(calls).toEqual([expect.objectContaining({ method: "answerCallbackQuery", body: expect.objectContaining({ show_alert: true }) })])
    expect((await db.select().from(registrations).where(eq(registrations.id, registrationId)))[0].status).toBe("pending")

    stub()
    await handleTelegramUpdate({ callback_query: { id: "q1", from: { id: 111 }, data: `pay:${registrationId}` } })
    const [reg] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(reg).toMatchObject({ status: "confirmed", paymentMethod: "transfer" })
    expect(paymentEmail).toHaveBeenCalledWith(registrationId, "transfer")
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.entityId, registrationId))
    expect(entry).toMatchObject({ adminId: admin.id, action: "registration.payment" })
    const edits = calls.filter((c) => c.method === "editMessageText")
    expect(edits.map((c) => c.body.chat_id).sort()).toEqual(["111", "222"])
    expect(text(edits[0])).toContain("پرداخت تأیید شد")
    expect(text(edits[0])).toContain(`Mina ${run}`)
    expect(buttons(edits[0])).not.toContain("pay:")

    // Twice: Telegram says it is paid already, nothing more is recorded.
    stub()
    await handleTelegramUpdate({ callback_query: { id: "q2", from: { id: 222 }, data: `pay:${registrationId}` } })
    expect(calls.find((c) => c.method === "answerCallbackQuery")?.body.show_alert).toBe(true)
    await refreshAdminNotices(registrationId)
  }, 30_000)

  it("connects an admin who presses Start, by their username", async () => {
    const admin = await makeAdmin(`Sara ${run}`)
    const current = await getSetting("telegramAdmins")
    await setSetting("telegramAdmins", { ...current, people: [...current.people, { adminId: admin.id, username: "Sara_TG", chatId: null }] })
    stub()
    await handleTelegramUpdate({ message: { chat: { id: 333, type: "private" }, from: { id: 333, username: "sara_tg" }, text: "/start admin" } })
    expect((await getSetting("telegramAdmins")).people.find((p) => p.adminId === admin.id)?.chatId).toBe("333")
    expect(text(calls[0])).toContain(`Sara ${run}`)
    stub()
    await handleTelegramUpdate({ message: { chat: { id: 444, type: "private" }, from: { id: 444, username: "stranger" }, text: "/start" } })
    expect(text(calls[0])).toContain("فقط برای مدیرهای سایت")
  })

  it("lists the workshops running, their paid registrations and the cash to collect, and records cash brought to the workshop", async () => {
    const world = await makeWorld()
    const admin = await makeAdmin(`Nora ${run}`)
    const course = await makeCourse(world, admin.id, { status: "published", endsAt: new Date(Date.now() + 5 * 86_400_000) })
    const cash = await addRegistration(world, course, { status: "pending", amount: 300_000 })
    const paid = await addRegistration(world, course, { status: "confirmed", amount: 300_000 })
    await db.update(registrations).set({ participantName: `Cash ${run}`, paymentChoice: "cash" }).where(eq(registrations.id, cash))
    await db.update(registrations).set({ participantName: `Paid ${run}` }).where(eq(registrations.id, paid))
    const current = await getSetting("telegramAdmins")
    await setSetting("telegramAdmins", { ...current, people: [...current.people, { adminId: admin.id, username: "nora_tg", chatId: "555" }] })
    const press = (data: string) => handleTelegramUpdate({ callback_query: { id: "q", from: { id: 555 }, data, message: { chat: { id: 555 }, message_id: 7 } } })

    stub()
    await handleTelegramUpdate({ message: { chat: { id: 555, type: "private" }, from: { id: 555 }, text: "🎨 ورکشاپ‌های در حال برگزاری" } })
    expect(text(calls[0])).toContain("ورکشاپ‌های در حال برگزاری")
    expect(buttons(calls[0])).toContain("ws:")

    stub()
    await press(`ws:${course}`)
    const card = calls.find((c) => c.method === "editMessageText")!
    expect(text(card)).toContain("ثبت‌نام: ۲ نفر")
    expect(buttons(card)).toContain(`cash:${course}`)

    stub()
    await press(`paid:${course}`)
    expect(text(calls.find((c) => c.method === "editMessageText")!)).toContain(`Paid ${run}`)

    stub()
    await press(`cash:${course}`)
    const list = calls.find((c) => c.method === "editMessageText")!
    expect(text(list)).toContain(`Cash ${run}`)
    expect(buttons(list)).toContain(`cpay:${cash}`)

    stub()
    await press(`cpay:${cash}`)
    expect((await db.select().from(registrations).where(eq(registrations.id, cash)))[0]).toMatchObject({ status: "confirmed", paymentMethod: "cash" })
    expect(buttons(calls.find((c) => c.method === "editMessageText")!)).not.toContain(`cpay:${cash}`)

    // Not an admin: no menu.
    stub()
    await handleTelegramUpdate({ message: { chat: { id: 777, type: "private" }, from: { id: 777 }, text: "/menu" } })
    expect(text(calls[0])).toContain("فقط برای مدیرهای سایت")
  }, 30_000)

  it("takes updates only with the secret Telegram was given", async () => {
    const post = (secret: string) =>
      webhook(new Request("http://x/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: "{}" }))
    expect((await post("wrong")).status).toBe(401)
    expect((await post(`s-${run}`)).status).toBe(200)
  })
})
