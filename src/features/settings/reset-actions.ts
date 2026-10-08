"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getTranslations } from "next-intl/server"

import { db } from "@/db"
import { admins } from "@/db/schema"
import { locales } from "@/i18n/routing"
import { adminAction, UserError } from "@/lib/action"
import { verifyPassword } from "@/lib/auth/password"
import { createRateLimiter } from "@/lib/auth/rate-limit"
import { runFactoryReset } from "./reset"
import { factoryResetSchema } from "./reset-schema"

/** The password is checked: 5 tries per admin per 15 minutes. */
const passwordLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 })

/** The phrase as typed, compared loosely (case, spaces, Persian ی/ك forms). */
const phrase = (text: string) =>
  text.normalize("NFC").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[\s‌]+/g, " ").trim().toLocaleLowerCase("tr")

/**
 * Settings → Danger zone: "Delete all transactions and reset". Needs the
 * admin's own password and the confirmation phrase (in any of the site's
 * languages). What it removes and what it keeps: `features/settings/reset.ts`.
 * Logged as "setting.factory_reset" with the counts.
 */
export const factoryReset = adminAction(factoryResetSchema, async (input, ctx) => {
  const phrases = await Promise.all(
    locales.map(async (locale) => phrase((await getTranslations({ locale, namespace: "settings.danger" }))("confirmPhrase"))),
  )
  if (!phrases.includes(phrase(input.confirm))) throw new UserError("settings.danger.errors.phrase", { field: "confirm" })

  const id = ctx.admin.id
  if (!passwordLimiter.consume(id).ok) throw new UserError("settings.danger.errors.rateLimited")
  const [me] = await db.select({ hash: admins.passwordHash }).from(admins).where(eq(admins.id, id)).limit(1)
  if (!me || !(await verifyPassword(me.hash, input.password))) {
    throw new UserError("settings.danger.errors.wrongPassword", { field: "password" })
  }

  const counts = await db.transaction(async (tx) => {
    const removed = await runFactoryReset(tx)
    await ctx.audit({ action: "setting.factory_reset", entity: "setting", entityId: "factory_reset", data: removed }, tx)
    return removed
  })
  // Every money figure on every page changed.
  revalidatePath("/", "layout")
  return counts
})
