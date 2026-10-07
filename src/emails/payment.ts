import { localized } from "@/lib/format"
import type { SettingValue } from "@/lib/settings"
import type { EmailProps } from "./templates"

type PaymentWays = Pick<EmailProps<"registration_received">, "cash" | "transfer" | "paymentUrl" | "onlineNote">

/**
 * The payment ways of `registration_received`, from the `payment` setting and
 * the workshop's own payment link (`courses.payment_url`), with the admin's
 * notes in the email's language. A way that is on but cannot be used is left
 * out: a bank transfer without an IBAN, or online payment for a workshop
 * without a link.
 *
 *   props: { ...details, ...paymentWays(await getSetting("payment"), course.paymentUrl, locale) }
 */
export function paymentWays(
  payment: SettingValue<"payment">,
  paymentUrl: string | null | undefined,
  locale: string,
): PaymentWays {
  const note = (text: Parameters<typeof localized>[0]) => localized(text, locale) || undefined
  const { transfer, online } = payment
  return {
    ...(payment.cash ? { cash: true as const } : {}),
    ...(transfer.enabled && transfer.iban
      ? {
          transfer: {
            accountHolder: transfer.accountHolder,
            bankName: transfer.bankName,
            iban: transfer.iban,
            note: note(transfer.note),
          },
        }
      : {}),
    ...(online.enabled && paymentUrl ? { paymentUrl, onlineNote: note(online.note) } : {}),
  }
}
