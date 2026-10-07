import { useLocale, useTranslations } from "next-intl"

import { StatusBadge, type StatusTone } from "@/components/admin/status-badge"
import { isolate } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"
import { paymentState, refundState, type RegistrationStatus } from "../schema"

const tones = { unpaid: "warning", paid: "success", free: "success", cancelled: "neutral" } as const satisfies Record<
  string,
  StatusTone
>

/**
 * The payment status of a registration, in words (never colour alone):
 * "Not paid yet", "Paid", "Registered" (free workshop) or "Cancelled", and
 * for a cancelled one its refund: "Refund of ₺… on its way" / "Refunded".
 * Works in server and client components.
 */
export function PaymentBadge({
  registration,
  className,
}: {
  registration: { status: RegistrationStatus; amount: number; refundAmount: number | null; refundedAt: Date | null }
  className?: string
}) {
  const t = useTranslations("registration.status")
  const locale = useLocale()
  const state = paymentState(registration)
  const refund = state === "cancelled" ? refundState(registration) : "none"
  const amount = formatLira(registration.refundAmount ?? 0, locale)

  return (
    <span className={cn("inline-flex flex-wrap gap-1.5", className)}>
      <StatusBadge tone={tones[state]} className="h-7 px-3 text-[0.8rem]">
        {t(state)}
      </StatusBadge>
      {refund === "due" && (
        <StatusBadge tone="info" className="h-7 px-3 text-[0.8rem]">
          {t("refundDue", { amount: isolate(amount) })}
        </StatusBadge>
      )}
      {refund === "sent" && (
        <StatusBadge tone="success" className="h-7 px-3 text-[0.8rem]">
          {t("refundSent", { amount: isolate(amount) })}
        </StatusBadge>
      )}
    </span>
  )
}
