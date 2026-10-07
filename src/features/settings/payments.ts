/**
 * Settings → Payments: how students pay (any combination of cash at the
 * workshop, bank transfer, the workshop's online payment link). The form
 * schema, shared by the page (client) and `savePaymentSettings` (server); the
 * stored setting (`payment` in lib/settings.ts) checks the value again.
 * No server-only imports.
 */
import { z } from "zod"

import { localizedText } from "@/components/admin/form/schemas"
import { normalizeDigits } from "@/lib/format"

const E = "settings.payments.errors"

/** "tr33 0006 1005…" (spaces, lower case, Persian digits) → "TR330006100…". */
export const cleanIban = (value: string) => normalizeDigits(value).replace(/[\s-]+/g, "").toUpperCase()

/**
 * The IBAN check (ISO 13616, mod 97): the first four characters move to the
 * end, letters become numbers (A = 10 … Z = 35), and the whole number leaves
 * 1 when divided by 97. Catches a mistyped or swapped digit.
 */
export function ibanChecksumOk(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let rest = 0
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97
  return rest === 1
}

/**
 * Why a Turkish IBAN is not valid, as a message key, or null when it is:
 * TR, then 24 digits (26 characters), with a correct check.
 */
export function ibanProblem(iban: string): string | null {
  if (!iban.startsWith("TR")) return `${E}.ibanCountry`
  if (!/^TR\d{24}$/.test(iban)) return `${E}.ibanLength`
  if (!ibanChecksumOk(iban)) return `${E}.ibanChecksum`
  return null
}

const note = localizedText({ max: 500 })
const line = z.string().trim().max(120)

export const paymentSettingsSchema = z
  .object({
    cash: z.boolean(),
    transfer: z.object({
      enabled: z.boolean(),
      accountHolder: line,
      bankName: line,
      /** As typed (spaces allowed); stored without spaces. Empty = none. */
      iban: z
        .string()
        .max(60)
        .transform(cleanIban)
        .superRefine((iban, ctx) => {
          const problem = iban ? ibanProblem(iban) : null
          if (problem) ctx.addIssue({ code: "custom", message: problem })
        }),
      note,
    }),
    online: z.object({ enabled: z.boolean(), note }),
  })
  .superRefine((v, ctx) => {
    if (!v.cash && !v.transfer.enabled && !v.online.enabled) {
      ctx.addIssue({ code: "custom", path: ["cash"], message: `${E}.oneWay` })
    }
    if (v.transfer.enabled) {
      if (!v.transfer.accountHolder) ctx.addIssue({ code: "custom", path: ["transfer", "accountHolder"], message: `${E}.holderRequired` })
      if (!v.transfer.iban) ctx.addIssue({ code: "custom", path: ["transfer", "iban"], message: `${E}.ibanRequired` })
    }
  })

export type PaymentSettingsValues = z.input<typeof paymentSettingsSchema>
export type PaymentSettings = z.output<typeof paymentSettingsSchema>
