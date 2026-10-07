"use client"

import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useEffect } from "react"
import { toast } from "sonner"

import { isSiteNotice } from "@/features/accounts/schema"

/**
 * Shows the one-time `?notice=…` an action left for this page (e.g. "check
 * your inbox" after signing up) as a friendly toast, then removes it from the
 * address bar, so a reload or a shared link does not show it again.
 */
export function NoticeToast() {
  const t = useTranslations("site.notices")
  const searchParams = useSearchParams()
  const notice = searchParams.get("notice")

  useEffect(() => {
    if (!notice) return
    if (isSiteNotice(notice)) toast.success(t(notice), { id: `notice-${notice}`, duration: 8000 })
    const url = new URL(window.location.href)
    url.searchParams.delete("notice")
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
  }, [notice, t])

  return null
}
