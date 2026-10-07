"use client"

import NextLink from "next/link"
import { usePathname as useNextPathname, useRouter as useNextRouter } from "next/navigation"
import { useLocale } from "next-intl"
import { useMemo, type ComponentProps } from "react"

import type { AppLocale } from "./locales"
import { useMainLocale } from "./main-locale-context"
import { localePath, stripLocale } from "./paths"

/**
 * Links and navigation in a language (docs/DEVELOPMENT.md, "URL rules"). Hrefs
 * are paths without a language ("/workshops", "/admin/categories/new"): the
 * main language's address has no prefix, the others get /fa or /en. The main
 * language comes from the language layout (`MainLocaleProvider`), so it follows
 * the setting, not a fixed default. Server components may render `Link` too.
 */

type Query = Record<string, string | number | boolean | readonly string[] | null | undefined>
export type Href = string | { pathname: string; query?: Query; hash?: string }

/** Only a path on this site is localized; "#x", "mailto:" and full URLs stay as they are. */
const isPath = (href: string) => href.startsWith("/") && !href.startsWith("//")

function useLocalize() {
  const current = useLocale()
  const main = useMainLocale()
  return (href: string, locale?: AppLocale) => (isPath(href) ? localePath(locale ?? current, href, main) : href)
}

/** `next/link` with the address in the current language, or in `locale` (a language switch). */
export function Link({
  href,
  locale,
  ...props
}: Omit<ComponentProps<typeof NextLink>, "href" | "locale"> & { href: Href; locale?: AppLocale }) {
  const localize = useLocalize()
  const to = typeof href === "string" ? localize(href, locale) : { ...href, pathname: localize(href.pathname, locale) }
  return <NextLink href={to} {...props} />
}

type NavigateOptions = { locale?: AppLocale; scroll?: boolean }

/** `next/navigation`'s router whose push / replace / prefetch take paths without a language. */
export function useRouter() {
  const router = useNextRouter()
  const current = useLocale()
  const main = useMainLocale()
  return useMemo(() => {
    const to = (href: string, locale?: AppLocale) => (isPath(href) ? localePath(locale ?? current, href, main) : href)
    return {
      ...router,
      push: (href: string, options?: NavigateOptions) => router.push(to(href, options?.locale), { scroll: options?.scroll ?? true }),
      replace: (href: string, options?: NavigateOptions) =>
        router.replace(to(href, options?.locale), { scroll: options?.scroll ?? true }),
      prefetch: (href: string, options?: { locale?: AppLocale }) => router.prefetch(to(href, options?.locale)),
    }
  }, [router, current, main])
}

/** The current page's path without its language ("/fa/workshops" and "/workshops" are both "/workshops"). */
export function usePathname(): string {
  return stripLocale(useNextPathname(), useLocale())
}
