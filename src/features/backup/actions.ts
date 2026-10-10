"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { adminAction, UserError } from "@/lib/action"
import { encrypt } from "@/lib/crypto"
import { getSetting, setSetting } from "@/lib/settings"
import { createBackup } from "./backup"
import { backupSettingsSchema } from "./schema"

/**
 * Settings → Backup: set or change the backup password (kept encrypted with
 * ENCRYPTION_KEY, never shown again) and switch the automatic backups. The
 * password itself is never written to the audit log.
 */
export const saveBackupSettings = adminAction(backupSettingsSchema, async ({ password, auto }, ctx) => {
  const saved = await getSetting("backup")
  if (!password && !saved.passwordEnc) throw new UserError("settings.backup.errors.noPassword", { field: "password" })
  const next = { passwordEnc: password ? encrypt(password) : saved.passwordEnc, auto }
  await db.transaction(async (tx) => {
    await setSetting("backup", next, tx)
    await ctx.audit({ action: "setting.update", entity: "setting", entityId: "backup", data: { auto, passwordChanged: Boolean(password) } }, tx)
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
