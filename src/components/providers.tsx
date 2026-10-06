"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"
import { Direction } from "radix-ui"
import { useEffect } from "react"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { isRtl } from "@/i18n/routing"

/** Light / dark / system theme, stored per browser. Wraps the whole document (root layout). */
export function ThemeProvider({ nonce, children }: { nonce?: string; children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      {children}
    </NextThemesProvider>
  )
}

/**
 * Everything that depends on the language: text direction for Radix
 * primitives, tooltips and toasts. Also keeps <html lang dir> in sync after a
 * client-side language switch (the root layout is not re-rendered then).
 */
export function LocaleProviders({ locale, children }: { locale: string; children: React.ReactNode }) {
  const dir = isRtl(locale) ? "rtl" : "ltr"

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = dir
  }, [locale, dir])

  return (
    <Direction.Provider dir={dir}>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster dir={dir} position={dir === "rtl" ? "bottom-left" : "bottom-right"} className="toaster group font-sans!" />
      </TooltipProvider>
    </Direction.Provider>
  )
}
