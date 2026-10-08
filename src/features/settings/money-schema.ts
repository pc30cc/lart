import { z } from "zod"

/** Settings → Money: whether partners may take money out of the wallet, and who pays the costs from it. */
export const moneySettingsSchema = z.object({
  withdrawals: z.boolean(),
  /** "" while nobody is chosen. */
  spenderId: z.union([z.literal(""), z.uuid({ error: "settings.money.errors.spender" })]),
})

export type MoneySettingsValues = z.input<typeof moneySettingsSchema>
