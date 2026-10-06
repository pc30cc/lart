import { useLocale } from "next-intl"

import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"

/**
 * An amount in Turkish lira, from integer kuruş. Works in server and client
 * components. `tone="signed"` colours negatives red and positives green.
 *   <Money value={course.price} />
 */
export function Money({
  value,
  tone = "plain",
  className,
}: {
  value: number
  tone?: "plain" | "signed"
  className?: string
}) {
  const locale = useLocale()
  return (
    <bdi
      className={cn(
        "tabular-nums whitespace-nowrap",
        tone === "signed" && value < 0 && "text-destructive",
        tone === "signed" && value > 0 && "text-success",
        className,
      )}
    >
      {formatLira(value, locale)}
    </bdi>
  )
}
