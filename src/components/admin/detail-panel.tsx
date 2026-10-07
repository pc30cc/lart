import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Parts of the admin detail pages (an instructor's profile, a student): a
 * titled card and the label + value rows of a definition list.
 */

/** A titled card of a detail page (instructor, student). `flush` removes the body padding (for tables). */
export function Panel({
  icon: Icon,
  title,
  description,
  badge,
  flush,
  className,
  children,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  badge?: React.ReactNode
  flush?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("bg-card ring-foreground/8 overflow-hidden rounded-xl shadow-xs ring-1", className)}>
      <header className="flex items-start gap-3 border-b px-5 py-4 md:px-6">
        {Icon && (
          <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className="text-sm leading-8 font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground -mt-1.5 text-xs text-pretty">{description}</p>}
        </div>
        {badge}
      </header>
      <div className={flush ? undefined : "p-5 md:p-6"}>{children}</div>
    </section>
  )
}

/** One label + value row of a definition list. */
export function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}
