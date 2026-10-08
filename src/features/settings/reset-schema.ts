import { z } from "zod"

/** Settings → Danger zone: the admin's password and the confirmation phrase typed out. */
export const factoryResetSchema = z.object({
  password: z.string().min(1, "settings.danger.errors.passwordNeeded").max(200),
  confirm: z.string().max(100),
})

export type FactoryResetValues = z.input<typeof factoryResetSchema>
