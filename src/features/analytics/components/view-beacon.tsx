"use client"

import { useLocale } from "next-intl"
import { useEffect, useRef } from "react"

import { usePathname } from "@/i18n/navigation"

/**
 * Tells the site a page was seen (the visit statistics in the panel): on
 * every page of the public site, also when moving between pages without a
 * reload. Sends the page without its language and its language; the site the
 * person came from only with the first page (later pages came from this
 * site). No cookie, nothing stored in the browser.
 */
export function ViewBeacon() {
  const path = usePathname()
  const locale = useLocale()
  const first = useRef(true)

  useEffect(() => {
    const referrer = first.current ? document.referrer || undefined : undefined
    first.current = false
    const body = JSON.stringify({ path, locale, referrer })
    try {
      if (!navigator.sendBeacon?.("/api/view", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/view", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {})
      }
    } catch {
      // Statistics never break a page.
    }
  }, [path, locale])

  return null
}
