import { useLocale } from "next-intl"

import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"

/**
 * An amount in Turkish lira, from integer kuruş. Works in server and client
 * components. `tone="signed"` colours negatives red and positives green.
 *   <Money value={course.price} />
 * `className` goes on an outer span that keeps the page's direction, so a
 * `block` amount lines up with its label in Persian too; only the inner
 * `<bdi>` isolates the left-to-right currency text.
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
    <span
      data-money=""
      className={cn(
        "tabular-nums whitespace-nowrap",
        tone === "signed" && value < 0 && "text-destructive",
        tone === "signed" && value > 0 && "text-success",
        className,
      )}
    >
      <bdi>{formatLira(value, locale)}</bdi>
    </span>
  )
}
