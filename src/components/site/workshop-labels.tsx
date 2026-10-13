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
              few && "bg-primary text-primary-foreground",
              !open && "bg-foreground/80 text-background",
            )
          : cn(
              open && !few && "bg-success/10 text-success",
              few && "bg-primary/10 text-primary",
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
 * How full a workshop (or one of its days) is, for visitors when Settings →
 * General shows it: one small bar per place, the taken ones filled in the
 * theme's main colour (a plain bar above 24 places), and under it "5
 * registered" and "3 places left" (or "Full"). Only the theme's own colours,
 * so it sits well in every theme. `label` names it for screen readers.
 */
export function SeatsMeter({ taken, left, label, className }: { taken: number; left: number; label: string; className?: string }) {
  const t = useTranslations("registration.seats")
  const max = taken + left
  const full = left <= 0
  return (
    <span className={cn("block", className)}>
      <span
        className="flex h-2 w-full gap-[3px]"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={taken}
        aria-label={`${label}: ${t("registered", { count: taken })}, ${full ? t("full") : t("left", { count: left })}`}
      >
        {max > 0 && max <= 24 ? (
          Array.from({ length: max }, (_, i) => (
            <span
              key={i}
              className={cn("h-full min-w-0 flex-1 rounded-full", i < taken ? (full ? "bg-primary/55" : "bg-primary") : "bg-primary/12")}
            />
          ))
        ) : (
          <span className="bg-primary/12 relative h-full w-full overflow-hidden rounded-full">
            <span
              className={cn("absolute inset-y-0 start-0 rounded-full", full ? "bg-primary/55" : "bg-primary")}
              style={{ width: `${max > 0 ? Math.min(100, (taken / max) * 100) : 100}%` }}
            />
          </span>
        )}
      </span>
      <span className="mt-2 flex items-baseline justify-between gap-3 text-xs tabular-nums">
        <span className="text-muted-foreground font-normal">{t("registered", { count: taken })}</span>
        <span className={cn("font-medium", full ? "text-muted-foreground" : "text-primary")}>
          {full ? t("full") : t("left", { count: left })}
        </span>
      </span>
    </span>
  )
}
