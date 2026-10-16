import { UserRoundIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Where a person has no photo: a round frame with a person in it (never the
 * first letter of their name). Decorative: the name is written next to it.
 * `className` sets the size (and may change the colours).
 */
export function PersonPlaceholder({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("bg-primary/10 text-primary/70 flex shrink-0 items-center justify-center overflow-hidden rounded-full", className)}>
      <UserRoundIcon className="size-[55%]" strokeWidth={1.75} />
    </span>
  )
}
