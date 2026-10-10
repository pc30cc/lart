import { z } from "zod"

/** Settings → Backup: whether the backups are made by themselves. */
export const backupSettingsSchema = z.object({
  auto: z.boolean(),
})

export type BackupSettingsValues = z.input<typeof backupSettingsSchema>
