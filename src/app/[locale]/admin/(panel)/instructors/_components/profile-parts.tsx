import type { LucideIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import type { Locale, LocalizedText } from "@/db/schema"
import { cn } from "@/lib/utils"

const LOCALES: Locale[] = ["fa", "tr", "en"]

/** A titled card of the profile page. `flush` removes the body padding (for tables). */
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

/** A small "Public" / "Private" marker in a panel header. */
export function VisibilityBadge({ icon: Icon, tone, children }: { icon: LucideIcon; tone: "public" | "private"; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium",
        tone === "private" ? "bg-warning/10 text-warning" : "bg-success/10 text-success",
      )}
    >
      <Icon aria-hidden className="size-3" />
      {children}
    </span>
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

/** A text in each language, with the language name beside it; missing ones are marked. */
export function LocalizedValue({ text, multiline }: { text: LocalizedText | null; multiline?: boolean }) {
  const t = useTranslations("common")
  return (
    <ul className="space-y-1.5">
      {LOCALES.map((l) => (
        <li key={l} className="flex gap-3">
          <span className="text-muted-foreground w-14 shrink-0 pt-px text-xs leading-5" lang={l}>
            {t(`locales.${l}`)}
          </span>
          {text?.[l] ? (
            <bdi lang={l} className={cn("min-w-0 break-words", multiline && "whitespace-pre-line")}>
              {text[l]}
            </bdi>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </li>
      ))}
    </ul>
  )
}
