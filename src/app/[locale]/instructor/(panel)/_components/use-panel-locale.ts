"use client"

import { useTransition } from "react"

import { setInstructorLocaleAction } from "@/features/accounts/actions"
import { usePathname, useRouter } from "@/i18n/navigation"
import type { AppLocale } from "@/i18n/routing"

/**
 * Show the panel in another language. It also becomes the instructor's own
 * language (instructors.locale: their emails and panel). Saving never blocks
 * the switch: the page changes language even if it fails.
 */
export function usePanelLocale() {
  const pathname = usePathname()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function switchTo(locale: AppLocale) {
    startTransition(async () => {
      await setInstructorLocaleAction({ locale }).catch(() => undefined)
      router.replace(pathname, { locale, scroll: false })
    })
  }

  return { switchTo, pending }
}
