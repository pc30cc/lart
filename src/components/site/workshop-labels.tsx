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
 * The registration state as a small pill: "Registration open", "Full",
 * "Registration closed", ... Visitors never see how many places there are
 * or are left, only that it is full. `overlay` sits on a photo.
 */
export function AvailabilityBadge({
  window,
  overlay = false,
  className,
}: {
  window: RegistrationWindow
  /** Not shown (only "Full" when none are left); kept for the callers. */
  seatsLeft?: number
  overlay?: boolean
  className?: string
}) {
  const t = useTranslations("registration")
  const open = window === "open"
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full px-3 text-xs font-medium whitespace-nowrap",
        overlay
          ? cn(
              "shadow-xs backdrop-blur-sm",
              open && "bg-background/90 text-foreground",
              !open && "bg-foreground/80 text-background",
            )
          : cn(
              open && "bg-success/10 text-success",
              !open && "bg-muted text-muted-foreground",
            ),
        className,
      )}
    >
      {t(`window.${window}`)}
    </span>
  )
}
