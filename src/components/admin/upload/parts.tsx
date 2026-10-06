"use client"

import { CircleAlertIcon, XIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

/** The empty state: a calm dashed area that opens the file picker and takes dropped files. */
export function Dropzone({
  icon,
  title,
  hint,
  dragging,
  className,
  ...props
}: ComponentProps<"button"> & { icon: ReactNode; title: ReactNode; hint?: ReactNode; dragging?: boolean }) {
  return (
    <button
      type="button"
      data-dragging={dragging || undefined}
      className={cn(
        "group/drop relative flex w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-dashed border-border bg-muted/30 px-6 py-8 text-center outline-none transition-[background-color,border-color,box-shadow,transform] duration-200",
        "hover:border-foreground/25 hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive",
        "data-dragging:scale-[1.01] data-dragging:border-primary data-dragging:bg-primary/5",
        className,
      )}
      {...props}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border transition-transform duration-200 group-hover/drop:-translate-y-0.5 group-data-dragging/drop:-translate-y-0.5 group-data-dragging/drop:text-primary [&_svg]:size-5">
        {icon}
      </span>
      <span className="max-w-xs text-sm font-medium text-balance">{title}</span>
      {hint && <span className="max-w-xs text-xs text-balance text-muted-foreground">{hint}</span>}
    </button>
  )
}

/** Progress shown over a preview while a file uploads. */
export function UploadOverlay({
  label,
  progress,
  cancelLabel,
  onCancel,
}: {
  label: ReactNode
  progress: number
  cancelLabel: string
  onCancel: () => void
}) {
  return (
    <div className="absolute inset-0 flex flex-col justify-end bg-linear-to-t from-black/70 via-black/25 to-black/10 p-3 text-white">
      <div className="flex items-center justify-between gap-3">
        <span aria-live="polite" className="text-xs font-medium tabular-nums drop-shadow-sm">
          {label}
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={cancelLabel}
          title={cancelLabel}
          onClick={onCancel}
          className="text-white hover:bg-white/20 hover:text-white"
        >
          <XIcon />
        </Button>
      </div>
      <Progress
        value={Math.round(progress * 100)}
        aria-label={typeof label === "string" ? label : undefined}
        className="mt-2 h-1.5 bg-white/25 rtl:-scale-x-100 [&>[data-slot=progress-indicator]]:bg-white"
      />
    </div>
  )
}

/** A friendly error line with an optional retry. */
export function UploadMessage({
  children,
  action,
  id,
  tone = "error",
}: {
  children: ReactNode
  action?: ReactNode
  id?: string
  tone?: "error" | "info"
}) {
  return (
    <div
      id={id}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-sm animate-in fade-in-0 slide-in-from-top-1",
        tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
      )}
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1 text-pretty">{children}</span>
      {action}
    </div>
  )
}

/** Small round icon buttons over media (replace, remove, move). */
export function OverlayButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="secondary"
      className={cn("rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-black/5 backdrop-blur hover:bg-background", className)}
      {...props}
    />
  )
}
