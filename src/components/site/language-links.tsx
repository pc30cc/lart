"use client"

import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"

import { Link, usePathname } from "@/i18n/navigation"
import { locales } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { useSwitchLocale } from "./use-switch-locale"

/**
 * This page in the other languages, as plain links in the footer: search
 * engines follow them from page to page (the header's language menu is a
 * button). Each is written in its own language. A signed-in member's choice
 * also becomes their emails' language, as with the header's menu.
 */
export function LanguageLinks({ signedIn, className, linkClassName }: { signedIn: boolean; className?: string; linkClassName?: string }) {
  const t = useTranslations("common")
  const locale = useLocale()
  const pathname = usePathname()
  // The query goes along (a reset link's token, ?next=…); a page with one is not indexed anyway.
  const query = Object.fromEntries(useSearchParams())
  const { switchTo } = useSwitchLocale(signedIn)

  return (
    <nav aria-label={t("language")} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {locales
        .filter((l) => l !== locale)
        .map((l) => (
          <Link
            key={l}
            href={{ pathname, query }}
            locale={l}
            hrefLang={l}
            lang={l}
            onClick={(event) => {
              // A plain click of a signed-in member also saves their emails' language; a new tab or window does not.
              if (!signedIn || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              switchTo(l)
            }}
            className={cn(
              "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-current/30",
              l === "fa" && "font-(family-name:--font-iransans)",
              linkClassName,
            )}
          >
            {t(`locales.${l}`)}
          </Link>
        ))}
    </nav>
  )
}
