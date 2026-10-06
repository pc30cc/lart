import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BanknoteIcon,
  HandCoinsIcon,
  LockIcon,
  ReceiptTextIcon,
  RotateCcwIcon,
  ScaleIcon,
  TicketIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react"

import { Money } from "@/components/admin/money"
import type { TransactionKind } from "@/features/money/ledger"
import { cn } from "@/lib/utils"

/** One icon per kind of entry, so lists can be scanned at a glance. */
export const kindIcons: Record<TransactionKind, LucideIcon> = {
  capital_contribution: ArrowDownToLineIcon,
  capital_withdrawal: ArrowUpFromLineIcon,
  expense: ReceiptTextIcon,
  registration_payment: TicketIcon,
  registration_refund: RotateCcwIcon,
  instructor_advance: HandCoinsIcon,
  instructor_payment: BanknoteIcon,
  course_settlement: ScaleIcon,
  course_close: LockIcon,
  reversal: Undo2Icon,
}

/**
 * Small presentational pieces shared by the money pages and the workshop
 * finances page (server or client components).
 */

/** A figure card: label, big value, an optional hint and icon. */
export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  size = "default",
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: LucideIcon
  tone?: "neutral" | "brand" | "success" | "danger" | "warning"
  size?: "default" | "lg"
  className?: string
}) {
  return (
    <div className={cn("bg-card ring-foreground/8 flex min-w-0 flex-col gap-2 rounded-xl p-4 shadow-xs ring-1 md:p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">{label}</span>
        {Icon && (
          <span
            aria-hidden
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
              tone === "brand" && "bg-primary/10 text-primary",
              tone === "success" && "bg-success/10 text-success",
              tone === "danger" && "bg-destructive/10 text-destructive",
              tone === "warning" && "bg-warning/10 text-warning",
              tone === "neutral" && "bg-muted text-muted-foreground",
            )}
          >
            <Icon />
          </span>
        )}
      </div>
      <div
        className={cn(
          "font-semibold tracking-tight tabular-nums",
          size === "lg" ? "text-3xl md:text-4xl" : "text-xl md:text-2xl",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-muted-foreground text-xs text-pretty">{hint}</div>}
    </div>
  )
}

/** A titled card for a block of a page. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("bg-card ring-foreground/8 rounded-xl shadow-xs ring-1", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 md:px-5 md:pt-5">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground text-sm text-pretty">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  )
}

/** A label / amount row, e.g. inside a breakdown. `strong` for a total. */
export function Row({
  label,
  value,
  tone,
  strong,
  hint,
}: {
  label: React.ReactNode
  value: number
  tone?: "signed" | "negative"
  strong?: boolean
  hint?: React.ReactNode
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", strong && "border-t pt-3 font-semibold")}>
      <span className={cn("min-w-0", !strong && "text-muted-foreground")}>
        {label}
        {hint && <span className="text-muted-foreground block text-xs font-normal">{hint}</span>}
      </span>
      <Money value={tone === "negative" && value !== 0 ? -value : value} tone={tone ? "signed" : "plain"} />
    </div>
  )
}

/** The calm "on paper" document look for print (reports, locked figures). */
export const printCss = `@media print {
  @page { size: A4; margin: 14mm 12mm; }
  html, body { background: #fff !important; color: #000 !important; }
  [data-slot="sidebar"], [data-slot="sidebar-inset"] > header, [data-print="hide"] { display: none !important; }
  [data-slot="sidebar-wrapper"], [data-slot="sidebar-inset"] { display: block !important; margin: 0 !important; min-height: 0 !important; background: #fff !important; box-shadow: none !important; }
  #content { max-width: none !important; padding: 0 !important; animation: none !important; }
  [data-print="show"] { display: block !important; }
  .shadow-xs, .ring-1 { box-shadow: none !important; }
  table { font-size: 10pt; }
  tr { break-inside: avoid; }
}`
