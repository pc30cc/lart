"use client"

import { createContext, use } from "react"

import type { AppLocale } from "./locales"

const MainLocaleContext = createContext<{ main: AppLocale; site: readonly AppLocale[] } | null>(null)

/**
 * The main language for client links (`@/i18n/navigation`) and the languages
 * the public site is shown in (Settings → General), given by the language layout.
 */
export function MainLocaleProvider({ value, site, children }: { value: AppLocale; site: readonly AppLocale[]; children: React.ReactNode }) {
  return <MainLocaleContext value={{ main: value, site }}>{children}</MainLocaleContext>
}

/** The main language: its pages have no prefix. Only below `[locale]/layout.tsx`. */
export function useMainLocale(): AppLocale {
  const value = use(MainLocaleContext)
  if (!value) throw new Error("MainLocaleProvider missing")
  return value.main
}

/** The languages the public site is shown in (the site's language menus offer only these). */
export function useSiteLocales(): readonly AppLocale[] {
  const value = use(MainLocaleContext)
  if (!value) throw new Error("MainLocaleProvider missing")
  return value.site
}
