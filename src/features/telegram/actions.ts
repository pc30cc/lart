"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { courses } from "@/db/schema"
import { adminAction } from "@/lib/action"
import { encrypt } from "@/lib/crypto"
import { UserError } from "@/lib/errors"
import { getSetting, setSetting } from "@/lib/settings"
import { connectBot, newWebhookSecret, sendAdminTest } from "./admin-notices"
import { telegramAdminsSchema, telegramSettingsSchema } from "./schema"
import { postWorkshop, sendTelegramTest, telegramConfig, telegramToken } from "./telegram"

/**
 * Settings → Telegram. An empty token keeps the saved one (it is never sent
 * back to the page). Audited as "setting.update" of "telegram", without the token.
 */
export const saveTelegramSettings = adminAction(telegramSettingsSchema, async (input, ctx) => {
  const current = await getSetting("telegram")
  const next = {
    botTokenEnc: input.botToken ? encrypt(input.botToken) : current.botTokenEnc,
    chatId: input.chatId,
    locale: input.locale,
  }
  await db.transaction(async (tx) => {
    await setSetting("telegram", next, tx)
    await ctx.audit(
      {
        action: "setting.update",
        entity: "setting",
        entityId: "telegram",
        data: { chatId: next.chatId, locale: next.locale, tokenChanged: Boolean(input.botToken) },
      },
      tx,
    )
  })
  return { tokenSaved: Boolean(next.botTokenEnc) }
})

/** "Send a test": a short message to the channel with the saved bot. */
export const sendTelegramTestAction = adminAction(z.object({}), async () => {
  const config = await telegramConfig()
  if (!config) throw new UserError("settings.telegram.errors.notSet")
  await sendTelegramTest(config)
})

/**
 * A super admin approves the workshop's post: it goes to the channel now
 * (again, if it was sent before). Audited as "workshop.telegram".
 */
export const postWorkshopToTelegramAction = adminAction(z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  const { messageId } = await postWorkshop(id)
  const now = new Date()
  await db.update(courses).set({ telegramPostedAt: now, telegramMessageId: messageId }).where(eq(courses.id, id))
  await ctx.audit({ action: "workshop.telegram", entity: "workshop", entityId: id, data: { messageId } })
  revalidatePath("/[locale]/admin/workshops/[id]", "page")
  return { postedAt: now.toISOString() }
})

/**
 * Settings → Telegram → Admins: each admin's Telegram username, whether the
 * registrations and receipts are sent and in which language. Saving points
 * the bot at this site (its webhook, with a secret) and keeps each admin's
 * chat while their username stays the same (a new one: they press Start
 * again). Audited as "setting.update" of "telegramAdmins".
 */
export const saveTelegramAdmins = adminAction(telegramAdminsSchema, async (input, ctx) => {
  const token = await telegramToken()
  if (!token) throw new UserError("settings.telegram.errors.notSet")
  const current = await getSetting("telegramAdmins")
  const clean = (u: string) => u.trim().replace(/^@/, "")
  const people = input.people
    .filter((p) => clean(p.username))
    .map((p) => {
      const before = current.people.find((c) => c.adminId === p.adminId)
      const username = clean(p.username)
      return { adminId: p.adminId, username, chatId: before && before.username.toLowerCase() === username.toLowerCase() ? before.chatId : null }
    })
  const secret = current.secret || newWebhookSecret()
  const botUsername = await connectBot(token, secret)
  const next = { notify: input.notify, locale: input.locale, people, secret, botUsername }
  await db.transaction(async (tx) => {
    await setSetting("telegramAdmins", next, tx)
    await ctx.audit(
      {
        action: "setting.update",
        entity: "setting",
        entityId: "telegramAdmins",
        data: { notify: next.notify, locale: next.locale, people: people.map((p) => ({ adminId: p.adminId, username: p.username })) },
      },
      tx,
    )
  })
  revalidatePath("/[locale]/admin/settings/telegram", "page")
  return { botUsername, people: people.map((p) => ({ adminId: p.adminId, connected: Boolean(p.chatId) })) }
})

/** "Send a test" to the admins connected; refused when none is. */
export const sendAdminTestAction = adminAction(z.object({}), async () => {
  const sent = await sendAdminTest()
  if (!sent) throw new UserError("settings.telegram.admins.noneConnected")
  return { sent }
})
