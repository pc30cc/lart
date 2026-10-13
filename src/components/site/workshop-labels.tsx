import { useLocale, useTranslations } from "next-intl"

import type { RegistrationWindow } from "@/features/registrations/schema"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"

/** "For adults" / "For children aged 7–12". */
export function AgeLabel({ ageMin, ageMax }: { ageMin: number | null; ageMax: number | null }) {
  const t = useTranslations("registration.age")
  return ageMin !== null && ageMax !== null ? t("children", { min: ageMin, max: ageMax }) : t("adults")
}

/** The price per person, or "Free". */
export function Price({ value, className }: { value: number; className?: string }) {
  const t = useTranslations("registration.price")
  const locale = useLocale()
  return (
    <span className={cn("font-semibold tabular-nums", className)}>
      {value > 0 ? <bdi>{formatLira(value, locale)}</bdi> : t("free")}
    </span>
  )
}

/**
 * The registration state as a small pill: "3 places left" (warm when few are
 * left) or "Registration open", "Full", "Registration closed", ... The number
 * is shown only when given (`seatsLeft`: Settings → General lets visitors
 * see it or not). `overlay` sits on a photo.
 */
export function AvailabilityBadge({
  window,
  seatsLeft,
  overlay = false,
  className,
}: {
  window: RegistrationWindow
  /** Places left, when visitors may see them; null/undefined: "Registration open". */
  seatsLeft?: number | null
  overlay?: boolean
  className?: string
}) {
  const t = useTranslations("registration")
  const open = window === "open"
  const shown = open && typeof seatsLeft === "number"
  const few = shown && seatsLeft <= 3
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full px-3 text-xs font-medium whitespace-nowrap",
        overlay
          ? cn(
              "shadow-xs backdrop-blur-sm",
              open && !few && "bg-background/90 text-foreground",
              few && "bg-warning text-white dark:text-black",
              !open && "bg-foreground/80 text-background",
            )
          : cn(
              open && !few && "bg-success/10 text-success",
              few && "bg-warning/12 text-warning",
              !open && "bg-muted text-muted-foreground",
            ),
        className,
      )}
    >
      {shown ? t("seats.left", { count: seatsLeft }) : t(`window.${window}`)}
    </span>
  )
}

/**
 * "5 registered · 3 places left" (or "Full") over a bar of how full it is, for
 * visitors when Settings → General shows it. `label` names the bar (the day).
 */
export function SeatsMeter({ taken, left, label, className }: { taken: number; left: number; label: string; className?: string }) {
  const t = useTranslations("registration.seats")
  const max = taken + left
  const pct = max > 0 ? Math.min(100, Math.round((taken / max) * 100)) : 100
  const tone = left <= 0 ? "bg-destructive/70" : left <= 3 ? "bg-warning" : "bg-primary"
  return (
    <span className={cn("block", className)}>
      <SeatsLine taken={taken} left={left} className="text-muted-foreground block text-xs font-normal" />
      <span
        className="bg-foreground/8 relative mt-1.5 block h-1.5 w-full overflow-hidden rounded-full"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={taken}
        aria-label={`${label}: ${t("registered", { count: taken })}`}
      >
        <span className={cn(tone, "absolute inset-y-0 start-0 rounded-full transition-all")} style={{ width: `${pct}%` }} />
      </span>
    </span>
  )
}

/** "5 registered · 3 places left" (or "Full"), for visitors when Settings → General shows it. */
export function SeatsLine({ taken, left, className }: { taken: number; left: number; className?: string }) {
  const t = useTranslations("registration.seats")
  return (
    <span className={cn("tabular-nums", className)}>
      {t("registered", { count: taken })}
      <span aria-hidden> · </span>
      <span className={cn(left <= 0 ? "text-destructive" : left <= 3 ? "text-warning" : undefined)}>
        {left > 0 ? t("left", { count: left }) : t("full")}
      </span>
    </span>
  )
}
