import { cn } from "@/lib/utils"

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand"

const tones: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground before:bg-muted-foreground/60",
  success: "bg-success/10 text-success before:bg-success",
  warning: "bg-warning/10 text-warning before:bg-warning",
  danger: "bg-destructive/10 text-destructive before:bg-destructive",
  info: "bg-info/10 text-info before:bg-info",
  brand: "bg-primary/10 text-primary before:bg-primary",
}

/**
 * A status pill with a dot: the label always carries the meaning, colour only
 * helps. Map your module's statuses to a tone and a translated label:
 *   <StatusBadge tone="success">{t("status.published")}</StatusBadge>
 */
export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        "before:size-1.5 before:shrink-0 before:rounded-full before:content-['']",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
