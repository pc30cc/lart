import { z } from "zod"

import { locales } from "@/i18n/locales"

/** A channel: "@name" (5–32 letters, digits or _) or its numeric id ("-100…"). */
export const TELEGRAM_CHAT = /^(@[A-Za-z][A-Za-z0-9_]{4,31}|-?\d{5,20})$/
/** A bot token from @BotFather: "<digits>:<35 characters>". */
export const TELEGRAM_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/

/** Settings → Telegram. An empty token keeps the saved one. */
export const telegramSettingsSchema = z.object({
  botToken: z
    .string()
    .trim()
    .refine((v) => v === "" || TELEGRAM_TOKEN.test(v), { error: "settings.telegram.errors.token" }),
  chatId: z
    .string()
    .trim()
    .refine((v) => v === "" || TELEGRAM_CHAT.test(v), { error: "settings.telegram.errors.chat" }),
  locale: z.enum(locales),
})
export type TelegramSettingsValues = z.input<typeof telegramSettingsSchema>

/** A Telegram username: "@name" or "name", 5–32 letters, digits or _. */
export const TELEGRAM_USERNAME = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/

/** Settings → Telegram → Admins: who gets the registrations and receipts, and in which language. */
export const telegramAdminsSchema = z.object({
  notify: z.boolean(),
  locale: z.enum(locales),
  people: z
    .array(
      z.object({
        adminId: z.uuid(),
        username: z
          .string()
          .trim()
          .refine((v) => v === "" || TELEGRAM_USERNAME.test(v), { error: "settings.telegram.errors.username" }),
      }),
    )
    .max(10),
})
export type TelegramAdminsValues = z.input<typeof telegramAdminsSchema>
