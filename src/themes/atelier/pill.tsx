import type { ComponentProps } from "react"

import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

/**
 * Atelier's pill button, as a link. `light`: cream on a photo; `outline`: a
 * thin line on the page; `solid`: the brick primary.
 */
export function PillLink({
  tone = "light",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { tone?: "light" | "outline" | "solid"; size?: "sm" | "md" }) {
  return <Link className={cn(pillClass(tone, size), className)} {...props} />
}

export function pillClass(tone: "light" | "outline" | "solid", size: "sm" | "md" = "md") {
  return cn(
    "at-caps inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap outline-none transition-[background-color,color,border-color,box-shadow] duration-300",
    "focus-visible:ring-3 focus-visible:ring-offset-2",
    size === "md"
      ? "h-12 px-7 text-[13px] sm:h-[52px] sm:px-8 sm:text-sm rtl:text-[15px]"
      : "h-10 px-5 text-xs sm:text-[13px] rtl:text-sm",
    tone === "light" &&
      "bg-at-paper text-at-brown shadow-[0_8px_24px_-12px_rgb(0_0_0/0.45)] hover:bg-at-cream hover:shadow-[0_10px_28px_-12px_rgb(0_0_0/0.55)] focus-visible:ring-at-paper/60 focus-visible:ring-offset-black/30",
    tone === "outline" &&
      "border-foreground/70 text-foreground hover:bg-foreground hover:text-background focus-visible:ring-ring/50 focus-visible:ring-offset-background border",
    tone === "solid" &&
      "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 focus-visible:ring-offset-background",
  )
}
