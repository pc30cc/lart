"use server"

import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { adminAction } from "@/lib/action"
import { changes } from "@/lib/audit"
import { getSetting, setSetting } from "@/lib/settings"
import { legalSettingsSchema } from "./legal-schema"

/** Settings → Legal details. Audited as "setting.update" of "legal" with what changed. */
export const saveLegalSettings = adminAction(legalSettingsSchema, async (input, ctx) => {
  const diff = changes(await getSetting("legal"), input)
  if (Object.keys(diff).length === 0) return { changed: false }
  await db.transaction(async (tx) => {
    await setSetting("legal", input, tx)
    await ctx.audit({ action: "setting.update", entity: "setting", entityId: "legal", data: diff }, tx)
  })
  // The legal pages, the Contact page and the footer show these.
  revalidatePath("/[locale]", "layout")
  return { changed: true }
})
