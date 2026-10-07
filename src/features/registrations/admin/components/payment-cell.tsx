import { Money } from "@/components/admin/money"
import { StatusBadge, type StatusTone } from "@/components/admin/status-badge"
import { formatDate } from "@/lib/format"
import { paymentState, refundState } from "../../schema"
import type { AdminRegistrationRow } from "../queries"

/**
 * Parts of the admin's registrations lists (a workshop's tab and
 * Registrations): the payment cell of a row, and the refund an admin may
 * still change. Server components: `t` is `workshops.registrations`.
 */

type PaymentRow = Pick<AdminRegistrationRow, "status" | "amount" | "paymentMethod" | "paidAt" | "refundAmount" | "refundedAt">
type Translate = (key: string, values?: Record<string, string | number>) => string

const tones = { unpaid: "warning", paid: "success", free: "success", cancelled: "neutral" } as const satisfies Record<
  string,
  StatusTone
>

/** "Not paid yet" / "Paid · Cash · 3 Oct" / "Free" / "Cancelled" with its refund. */
export function PaymentCell({ row: r, t, locale }: { row: PaymentRow; t: Translate; locale: string }) {
  const state = paymentState(r)
  const refund = state === "cancelled" ? refundState(r) : "none"
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={tones[state]}>{t(`state.${state}`)}</StatusBadge>
      {state === "paid" && r.paidAt && (
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {t("state.paidVia", { method: r.paymentMethod ?? "other", date: formatDate(r.paidAt, locale, "medium") })}
        </span>
      )}
      {refund === "due" && (
        <span className="text-info text-xs whitespace-nowrap">
          {t("state.refundOwed")} <Money value={r.refundAmount ?? 0} />
        </span>
      )}
      {refund === "sent" && r.refundedAt && (
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {t("state.refundSent", { date: formatDate(r.refundedAt, locale, "medium") })} <Money value={r.refundAmount ?? 0} />
        </span>
      )}
      {state === "cancelled" && refund === "none" && r.paidAt && (
        <span className="text-muted-foreground text-xs">{t("state.noRefund")}</span>
      )}
    </span>
  )
}

/**
 * A cancelled registration that was paid and not paid back yet: the refund
 * owed now (0 for a cancellation without refund), which "Change refund" may
 * change. Null for any other registration.
 */
export function refundOwed(r: PaymentRow): number | null {
  return r.status === "cancelled" && r.paidAt && !r.refundedAt && r.amount > 0 ? (r.refundAmount ?? 0) : null
}
