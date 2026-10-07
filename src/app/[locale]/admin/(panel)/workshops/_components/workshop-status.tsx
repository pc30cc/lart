import { useTranslations } from "next-intl"

import { StatusBadge, type StatusTone } from "@/components/admin/status-badge"
import type { WorkshopStatus } from "@/features/workshops/schema"
import { cn } from "@/lib/utils"

export const statusTone: Record<WorkshopStatus, StatusTone> = {
  awaiting_signature: "warning",
  published: "info",
  confirmed: "success",
  cancelled: "danger",
  closed: "neutral",
}

/** The workshop's lifecycle status as a pill (server or client). */
export function WorkshopStatusBadge({ status, className }: { status: WorkshopStatus; className?: string }) {
  const t = useTranslations("workshops.status")
  return (
    <StatusBadge tone={statusTone[status]} className={className}>
      {t(status)}
    </StatusBadge>
  )
}

/** Confirmed / maximum with a slim bar: amber below the minimum, green from the minimum, clay when full. */
export function FillMeter({
  registered,
  min,
  max,
  label,
  size = "sm",
  className,
}: {
  /** Everyone registered: paid and not paid yet. */
  registered: number
  min: number
  max: number
  label: string
  size?: "sm" | "lg"
  className?: string
}) {
  const pct = Math.min(100, Math.round((registered / Math.max(max, 1)) * 100))
  const tone = registered >= max ? "bg-primary" : registered >= min ? "bg-success" : "bg-warning"
  return (
    <div className={className}>
      <div className={size === "lg" ? "text-2xl font-semibold tabular-nums" : "text-sm tabular-nums"}>{label}</div>
      <div
        className={cn(
          "bg-muted relative mt-1.5 w-full overflow-hidden rounded-full",
          size === "lg" ? "mt-3 h-2" : "h-1.5 max-w-36",
        )}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={registered}
        aria-label={label}
      >
        <div className={cn(tone, "absolute inset-y-0 start-0 rounded-full transition-all")} style={{ width: `${pct}%` }} />
        {/* The minimum, as a tick on the bar. */}
        <div
          aria-hidden
          className="bg-foreground/35 absolute inset-y-0 w-px"
          style={{ insetInlineStart: `${Math.min(100, (min / Math.max(max, 1)) * 100)}%` }}
        />
      </div>
    </div>
  )
}
