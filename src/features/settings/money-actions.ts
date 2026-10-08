"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { admins } from "@/db/schema"
import { adminAction, UserError } from "@/lib/action"
import { changes } from "@/lib/audit"
import { getSetting, setSetting } from "@/lib/settings"
import { moneySettingsSchema } from "./money-schema"

/**
 * Settings → Money. The partner who pays the costs must be an active partner
 * (an admin). Audited as "setting.update" of "money" with what changed.
 */
export const saveMoneySettings = adminAction(moneySettingsSchema, async ({ withdrawals, spenderId }, ctx) => {
  const next = { withdrawals, spenderId: spenderId || null }
  if (next.spenderId) {
    const [partner] = await db
      .select({ id: admins.id })
      .from(admins)
      .where(and(eq(admins.id, next.spenderId), eq(admins.active, true)))
    if (!partner) throw new UserError("settings.money.errors.spender", { field: "spenderId" })
  }
  const diff = changes(await getSetting("money"), next)
  if (Object.keys(diff).length === 0) return { changed: false }
  await db.transaction(async (tx) => {
    await setSetting("money", next, tx)
    await ctx.audit({ action: "setting.update", entity: "setting", entityId: "money", data: diff }, tx)
  })
  // The wallet and workshop pages show or lock their buttons by these rules.
  revalidatePath("/[locale]/admin", "layout")
  return { changed: true }
})
