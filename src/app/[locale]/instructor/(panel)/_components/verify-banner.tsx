"use client"

import { HourglassIcon, MailIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { resendInstructorVerifyAction } from "@/features/accounts/actions"
import { useRouter } from "@/i18n/navigation"

/** "Please confirm your email", under the panel header until the email is confirmed, with "Send it again". */
export function VerifyBanner({ email }: { email: string }) {
  const t = useTranslations("instructorPanel.verifyBanner")
  const tc = useTranslations("common")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)

  function sendAgain() {
    startTransition(async () => {
      try {
        const result = await resendInstructorVerifyAction({})
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
    <div role="region" aria-label={t("label")} className="border-warning/25 bg-warning/10 border-b print:hidden">
      <div className="mx-auto flex max-w-4xl flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <p className="flex flex-1 items-start gap-2.5 text-sm leading-relaxed">
          <MailIcon className="text-warning mt-0.5 size-4.5 shrink-0" />
          <span className="text-pretty">
            {/* U+2068 / U+2069 isolate the address, so it reads correctly inside Persian text. */}
            {t(sent ? "textSent" : "text", { email: `⁨${email}⁩` })}
          </span>
        </p>
        <Button
          variant="outline"
          className="border-warning/40 h-10 shrink-0 self-start rounded-full px-4 sm:self-auto"
          onClick={sendAgain}
          disabled={pending}
        >
          {pending && <Spinner aria-hidden />}
          {t("resend")}
        </Button>
      </div>
    </div>
  )
}

/** "Thanks for signing up: the team is checking your details", until an admin approves a self-registered instructor. */
export function ApprovalBanner() {
  const t = useTranslations("instructorPanel.approvalBanner")
  return (
    <div role="region" aria-label={t("label")} className="border-info/25 bg-info/10 border-b print:hidden">
      <div className="mx-auto flex max-w-4xl px-4 py-3">
        <p className="flex flex-1 items-start gap-2.5 text-sm leading-relaxed">
          <HourglassIcon className="text-info mt-0.5 size-4.5 shrink-0" />
          <span className="text-pretty">{t("text")}</span>
        </p>
      </div>
    </div>
  )
}
