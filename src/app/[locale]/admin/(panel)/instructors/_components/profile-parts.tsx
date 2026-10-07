import type { LucideIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import type { Locale, LocalizedText } from "@/db/schema"
import { cn } from "@/lib/utils"

const LOCALES: Locale[] = ["fa", "tr", "en"]

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
