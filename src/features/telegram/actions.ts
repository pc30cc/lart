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
import { telegramSettingsSchema } from "./schema"
import { postWorkshop, sendTelegramTest, telegramConfig } from "./telegram"

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
