"use client"

import { useTranslations } from "next-intl"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** The one-line summary of an entry's data; click to see all of it. */
export function AuditData({ summary, detail }: { summary: string; detail: string }) {
  const t = useTranslations("settings.audit")
  if (!summary) return <span className="text-muted-foreground">—</span>
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          dir="auto"
          title={t("showDetails")}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 block max-w-56 truncate rounded-sm text-start font-mono text-xs outline-none focus-visible:ring-3 lg:max-w-80"
        >
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] p-0">
        <pre
          dir="ltr"
          className="max-h-96 overflow-auto p-3 text-start font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
        >
          {detail}
        </pre>
      </PopoverContent>
    </Popover>
  )
}
