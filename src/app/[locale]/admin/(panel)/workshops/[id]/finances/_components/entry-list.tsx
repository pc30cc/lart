import { useLocale, useTranslations } from "next-intl"

import { Money } from "@/components/admin/money"
import { StatusBadge } from "@/components/admin/status-badge"
import { isReversible, type WorkshopEntry } from "@/features/money/queries"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { kindIcons } from "../../../../money/_components/parts"
import { ReverseEntry } from "../../../../money/_components/reverse-entry"

/** A workshop's expenses, advance movements or instructor payments; mistakes are reversed, never edited. */
export function EntryList({ entries, empty }: { entries: WorkshopEntry[]; empty: string }) {
  const t = useTranslations("money")
  const locale = useLocale()
  if (!entries.length) return <p className="text-muted-foreground text-sm">{empty}</p>

  return (
    <ul className="-my-2 divide-y">
      {entries.map((e) => {
        const Icon = kindIcons[e.kind]
        const title =
          e.kind === "expense"
            ? e.description
            : e.kind === "instructor_advance"
              ? t(`finances.advance.${e.direction}`)
              : t("kinds.instructor_payment")
        const source =
          e.source.type === "partner"
            ? t("finances.paidBy", { name: e.source.name })
            : e.source.type === "advance"
              ? t("finances.fromAdvance")
              : t("finances.fromWallet")
        const note = e.kind !== "expense" && e.description ? ` · ${e.description}` : ""
        return (
          <li key={e.id} className={cn("flex items-center gap-3 py-3", e.reversedBy && "opacity-60")}>
            <span aria-hidden className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4">
              <Icon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className={cn("truncate", e.reversedBy && "line-through decoration-1")}>{title}</span>
                {e.reversedBy && <StatusBadge className="h-5">{t("ledger.reversed")}</StatusBadge>}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {formatDate(`${e.occurredOn}T09:00:00Z`, locale, "medium")} · {source}
                {note}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Money value={e.amount} className="text-sm font-semibold" />
              {isReversible(e) && <ReverseEntry id={e.id} what={title} size="xs" />}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
