"use client"

import { MailIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { resendMemberVerifyAction } from "@/features/accounts/actions"

/**
 * "Please confirm your email", under the site header on every page until the
 * member's email is confirmed, with a button to send the link again.
 */
export function VerifyBanner({ email }: { email: string }) {
  const t = useTranslations("site.verifyBanner")
  const tc = useTranslations("common")
  const [pending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)

  function sendAgain() {
    startTransition(async () => {
      try {
        const result = await resendMemberVerifyAction({})
        if (!result) return
        if (!result.ok) toast.error(result.error)
        else if (result.data.verified) toast.success(t("alreadyVerified"))
        else {
          setSent(true)
          toast.success(t("sent"))
        }
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <div role="region" aria-label={t("label")} className="border-warning/25 bg-warning/10 border-b">
      <div className="mx-auto flex max-w-6xl flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
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
