/*
 * Limer
 * Design by m [at] davoudi [dot] net
 */
import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { headers } from "next/headers"
import { getLocale } from "next-intl/server"

import { ThemeProvider } from "@/components/providers"
import { isRtl } from "@/i18n/routing"
import "./globals.css"

// Self-hosted fonts. Inter is split into latin and latin-ext (Turkish ğ ş ı İ);
// each face covers only its own characters, so the browser picks the right
// file per glyph. latin-ext is not preloaded: it loads only when needed.
const inter = localFont({
  src: "../fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
})

const interExt = localFont({
  src: "../fonts/inter-latin-ext-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter-ext",
  display: "swap",
  preload: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
})

const iranSans = localFont({
  src: [
    { path: "../fonts/iransans-400.woff2", weight: "400" },
    { path: "../fonts/iransans-500.woff2", weight: "500" },
    { path: "../fonts/iransans-700.woff2", weight: "700" },
  ],
  variable: "--font-iransans",
  display: "swap",
})

export const metadata: Metadata = {
  // Pages set their own titles; the brand comes from settings in [locale]/layout.
  formatDetection: { telephone: false, email: false, address: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfaf6" },
    { media: "(prefers-color-scheme: dark)", color: "#101319" },
  ],
}

/**
 * The document shell. The language comes from the proxy (the address's prefix,
 * or the main language for an address without one); `[locale]/layout.tsx`
 * validates it and adds the translated providers.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale()
  const nonce = (await headers()).get("x-nonce") ?? undefined

  return (
    <html
      lang={locale}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      className={`${inter.variable} ${interExt.variable} ${iranSans.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-svh">
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  )
}
