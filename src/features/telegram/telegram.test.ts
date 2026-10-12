import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { courses } from "@/db/schema"
import { createAdmin, createCategory, createInstructor, createTermsTemplate, runId } from "@/features/workshops/test-fixtures"
import { encrypt } from "@/lib/crypto"
import { deleteSetting, setSetting } from "@/lib/settings"
import { telegramSettingsSchema } from "./schema"
import { postWorkshop, workshopPost } from "./telegram"

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
