"use client"

import { KeyRoundIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"

import { ChangePasswordDialog } from "@/components/admin/change-password-dialog"
import { Button } from "@/components/ui/button"

/** "Change password" on the profile page: the same dialog as in the user menu. */
export function PasswordButton({ email }: { email: string }) {
  const t = useTranslations("auth.password")
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="lg" className="px-4" onClick={() => setOpen(true)}>
        <KeyRoundIcon />
        {t("menu")}
      </Button>
      <ChangePasswordDialog email={email} open={open} onOpenChange={setOpen} />
    </>
  )
}
