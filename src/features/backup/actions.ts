"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { adminAction } from "@/lib/action"
import { setSetting } from "@/lib/settings"
import { createBackup } from "./backup"
import { backupSettingsSchema } from "./schema"

/** Settings → Backup: switch the automatic backups on or off. */
export const saveBackupSettings = adminAction(backupSettingsSchema, async ({ auto }, ctx) => {
  await db.transaction(async (tx) => {
    await setSetting("backup", { auto }, tx)
    await ctx.audit({ action: "setting.update", entity: "setting", entityId: "backup", data: { auto } }, tx)
  })
  revalidatePath("/[locale]/admin/settings/backup", "page")
  return { changed: true }
})

/** "Back up now": the whole database, into today's folder (several a day go in the same folder). */
export const createManualBackup = adminAction(z.object({}), async (_, ctx) => {
  const made = await createBackup("manual", ctx.admin.id)
  await ctx.audit({ action: "backup.create", entity: "backup", entityId: made.id, data: { size: made.size } })
  revalidatePath("/[locale]/admin/settings/backup", "page")
  return { size: made.size }
})
