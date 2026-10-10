import { z } from "zod"

/**
 * Settings → Backup: the password the backups are locked with ("" keeps the
 * one set; typed twice, since a lost one cannot be recovered) and whether the
 * backups are made by themselves.
 */
export const backupSettingsSchema = z
  .object({
    password: z.union([z.literal(""), z.string().min(10, { error: "settings.backup.errors.passwordShort" }).max(128)]),
    confirm: z.string(),
    auto: z.boolean(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], error: "settings.backup.errors.passwordMismatch" })

export type BackupSettingsValues = z.input<typeof backupSettingsSchema>
