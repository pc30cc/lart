"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

import en from "../../messages/en/common.json"
import fa from "../../messages/fa/common.json"
import tr from "../../messages/tr/common.json"
import "./globals.css"

const texts = { fa: fa.panelError, tr: tr.panelError, en: en.panelError }

/**
 * The last resort, when the document shell itself fails (the root or the
 * language layout: e.g. the brand cannot be read). It replaces the whole
 * document, so it has its own `<html>` and no providers: the language comes
 * from the address, the texts straight from the messages. Never the error's
 * details.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const first = usePathname()?.split("/")[1]
  const locale = first === "fa" || first === "en" ? first : "tr"
  const t = texts[locale]
  useEffect(() => console.error(error), [error])

  return (
    <html lang={locale} dir={locale === "fa" ? "rtl" : "ltr"}>
      <body className="bg-background text-foreground flex min-h-svh items-center justify-center p-6 font-sans">
        <main className="flex max-w-sm flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-balance">{t.title}</h1>
          <p className="text-muted-foreground text-pretty">{t.description}</p>
          <button
            type="button"
            className="bg-primary text-primary-foreground mt-2 h-12 w-full rounded-xl px-6 text-base font-medium"
            onClick={() => retry()}
          >
            {t.retry}
          </button>
        </main>
      </body>
    </html>
  )
}
