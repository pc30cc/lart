"use client"

import { useSearchParams } from "next/navigation"
import { useTransition } from "react"

import { setMemberLocaleAction } from "@/features/accounts/actions"
import { usePathname, useRouter } from "@/i18n/navigation"
import type { AppLocale } from "@/i18n/routing"

/**
 * Show the same page in another language. For a signed-in member it also
 * becomes the language of their emails (members.locale).
 */
export function useSwitchLocale(signedIn: boolean) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function switchTo(locale: AppLocale) {
    const query = searchParams.toString()
    startTransition(async () => {
      if (signedIn) {
        // Never blocks the switch: the page still changes language if saving fails.
        await setMemberLocaleAction({ locale }).catch(() => undefined)
      }
      router.replace(query ? `${pathname}?${query}` : pathname, { locale, scroll: false })
    })
  }

  return { switchTo, pending }
}
