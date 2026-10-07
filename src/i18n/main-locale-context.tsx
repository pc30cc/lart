"use client"

import { createContext, use } from "react"

import type { AppLocale } from "./locales"

const MainLocaleContext = createContext<AppLocale | null>(null)

/** The main language for client links (`@/i18n/navigation`), given by the language layout. */
export function MainLocaleProvider({ value, children }: { value: AppLocale; children: React.ReactNode }) {
  return <MainLocaleContext value={value}>{children}</MainLocaleContext>
}

/** The main language: its pages have no prefix. Only below `[locale]/layout.tsx`. */
export function useMainLocale(): AppLocale {
  const value = use(MainLocaleContext)
  if (!value) throw new Error("MainLocaleProvider missing")
  return value
}
