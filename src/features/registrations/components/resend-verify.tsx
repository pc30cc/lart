"use client"

import { MailIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { resendMemberVerifyAction } from "@/features/accounts/actions"
import { useRouter } from "@/i18n/navigation"

/** "Send the link again" on the register page while the member's email is not confirmed. */
export function ResendVerify() {
  const t = useTranslations("registration.register.verify")
  const tc = useTranslations("common")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)

  function resend() {
    startTransition(async () => {
      try {
        const result = await resendMemberVerifyAction({})
        if (!result) return
        if (!result.ok) toast.error(result.error)
        else if (result.data.verified) {
          toast.success(t("alreadyVerified"))
          router.refresh()
        } else {
          setSent(true)
          toast.success(t("sent"))
        }
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <div className="space-y-3">
      <Button onClick={resend} disabled={pending} className="h-12 w-full rounded-xl text-base">
        {pending ? <Spinner aria-hidden /> : <MailIcon aria-hidden />}
        {t("resend")}
      </Button>
      {sent && (
        <p role="status" className="text-success text-center text-sm">
          {t("sent")}
        </p>
      )}
    </div>
  )
}
