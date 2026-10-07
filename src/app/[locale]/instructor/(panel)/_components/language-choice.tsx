"use client"

import { useLocale, useTranslations } from "next-intl"
import { useId } from "react"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { locales, type AppLocale } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { usePanelLocale } from "./use-panel-locale"

/** The language of the panel and of the instructor's emails: three large choices. */
export function LanguageChoice({ labelledBy }: { labelledBy?: string }) {
  const t = useTranslations("common")
  const current = useLocale()
  const id = useId()
  const { switchTo, pending } = usePanelLocale()

  return (
    <RadioGroup
      value={current}
      onValueChange={(next) => next !== current && switchTo(next as AppLocale)}
      disabled={pending}
      aria-labelledby={labelledBy}
      className="grid gap-2 sm:grid-cols-3"
    >
      {locales.map((l) => (
        <label
          key={l}
          htmlFor={`${id}-${l}`}
          className={cn(
            "flex h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-base transition-colors",
            l === current ? "border-primary bg-primary/6 font-medium" : "hover:bg-muted/60",
            pending && "opacity-60",
          )}
        >
          <RadioGroupItem id={`${id}-${l}`} value={l} className="size-5 [&_[data-slot=radio-group-indicator]]:size-5" />
          <span lang={l} className={cn(l === "fa" && "font-(family-name:--font-iransans)")}>
            {t(`locales.${l}`)}
          </span>
        </label>
      ))}
    </RadioGroup>
  )
}
