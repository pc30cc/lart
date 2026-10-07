"use client"

import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useEffect } from "react"
import { toast } from "sonner"

import { isAdminNotice } from "@/features/partners/schema"

/**
 * The panel's one-time `?notice=…` (e.g. "welcome" after accepting a partner
 * invitation) as a friendly toast; then the parameter leaves the address bar,
 * so a reload does not show it again. Only known notices are shown
 * (`adminNotices`, messages: partners.notices.<notice>).
 */
export function AdminNoticeToast() {
  const t = useTranslations("partners.notices")
  const searchParams = useSearchParams()
  const notice = searchParams.get("notice")

  useEffect(() => {
    if (!notice) return
    if (isAdminNotice(notice)) toast.success(t(notice), { id: `notice-${notice}`, duration: 12_000 })
    const url = new URL(window.location.href)
    url.searchParams.delete("notice")
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
  }, [notice, t])

  return null
}
