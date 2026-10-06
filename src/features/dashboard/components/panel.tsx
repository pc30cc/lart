import { cn } from "@/lib/utils"

/** Fades and lifts a card in when the dashboard appears (reduced motion: globals.css turns it off). */
export const enter = "animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500 ease-out"

/**
 * A dashboard card: title, one-line description, an optional action at the
 * end of the header, and its content. Works in server and client components.
 * `delay` staggers the entrance (ms).
 */
export function Panel({
  id,
  title,
  description,
  action,
  children,
  delay = 0,
  className,
}: {
  id: string
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("bg-card ring-foreground/8 flex min-w-0 flex-col rounded-2xl shadow-xs ring-1", enter, className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5">
        <div className="min-w-0 space-y-1">
          <h2 id={id} className="text-base leading-snug font-semibold tracking-tight">
            {title}
          </h2>
          {description && <p className="text-muted-foreground text-sm text-pretty">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      <div className="flex min-w-0 flex-1 flex-col px-5 pt-4 pb-5">{children}</div>
    </section>
  )
}
