"use client"

import { LanguagesIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSiteLocales } from "@/i18n/main-locale-context"
import { type AppLocale } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { useSwitchLocale } from "./use-switch-locale"

/** The language choices, each written in its own language (`options`: the site's languages by default; the instructor panel passes all). */
export function LocaleChoices({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (locale: AppLocale) => void
  options?: readonly AppLocale[]
}) {
  const t = useTranslations("common")
  const site = useSiteLocales()
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={(next) => next !== value && onChange(next as AppLocale)}>
      {(options ?? site).map((l) => (
        <DropdownMenuRadioItem key={l} value={l} className="py-2">
          <span lang={l} className={cn(l === "fa" && "font-(family-name:--font-iransans)")}>
            {t(`locales.${l}`)}
          </span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/**
 * FA / TR / EN in the site header (on a phone the icon only, so the brand
 * keeps its room). A signed-in member's emails follow the choice. A theme may
 * restyle the button (`className`).
 */
export function LocaleMenu({ signedIn, className }: { signedIn: boolean; className?: string }) {
  const t = useTranslations("common")
  const locale = useLocale()
  const { switchTo, pending } = useSwitchLocale(signedIn)
  // One language on the site: nothing to choose.
  if (useSiteLocales().length < 2) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn("h-10 gap-1.5 px-2.5 font-normal max-sm:w-10 max-sm:px-0", pending && "opacity-60", className)}
          aria-label={t("language")}
        >
          <LanguagesIcon className="size-4.5" />
          <span className="text-xs font-medium tracking-wide uppercase max-sm:hidden">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        <DropdownMenuLabel className="text-muted-foreground text-xs">{t("language")}</DropdownMenuLabel>
        <LocaleChoices value={locale} onChange={switchTo} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
