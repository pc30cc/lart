"use client"

import { LogOutIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { instructorLogoutAction } from "@/features/accounts/actions"

/** "Log out" as a plain button (on phones, at the end of the profile page). */
export function LogoutButton() {
  const t = useTranslations("instructorPanel.shell")
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      className="text-muted-foreground h-12 rounded-xl px-5 text-base"
      disabled={pending}
      onClick={() => startTransition(() => instructorLogoutAction())}
    >
      {pending ? <Spinner aria-hidden /> : <LogOutIcon className="rtl:-scale-x-100" />}
      {t("logOut")}
    </Button>
  )
}
