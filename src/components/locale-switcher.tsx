"use client"

import { LanguagesIcon } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePathname, useRouter } from "@/i18n/navigation"
import { locales, type AppLocale } from "@/i18n/routing"
import { cn } from "@/lib/utils"

/** FA / TR / EN switch that keeps the current page and query string. */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("common")
  const locale = useLocale()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function change(next: string) {
    if (next === locale) return
    const query = searchParams.toString()
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { locale: next as AppLocale, scroll: false })
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("gap-1.5 px-2 font-normal", pending && "opacity-60", className)}
          aria-label={t("language")}
        >
          <LanguagesIcon />
          <span className="text-xs font-medium uppercase tracking-wide">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        <DropdownMenuLabel className="text-muted-foreground text-xs">{t("language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={change}>
          {locales.map((l) => (
            <DropdownMenuRadioItem key={l} value={l}>
              <span lang={l} className={cn(l === "fa" && "font-(family-name:--font-iransans)")}>
                {t(`locales.${l}`)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
