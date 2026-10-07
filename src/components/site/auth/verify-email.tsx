"use client"

import { CircleCheckIcon, MailWarningIcon, SendIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useRef, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Link } from "@/i18n/navigation"
import {
  resendInstructorVerifyAction,
  resendMemberVerifyAction,
  verifyInstructorEmailAction,
  verifyMemberEmailAction,
} from "@/features/accounts/actions"
import type { AccountKind } from "./login-form"

const verify = { member: verifyMemberEmailAction, instructor: verifyInstructorEmailAction }
const resend = { member: resendMemberVerifyAction, instructor: resendInstructorVerifyAction }
const loginPage = { member: "/account/login", instructor: "/instructor/login" }

type State = "checking" | "done" | "failed"

/**
 * The page behind the link in the welcome email. It confirms the email by
 * itself once the page has loaded in a browser (a mail scanner that only
 * fetches the link does not use it up), then offers one way on. A link that
 * no longer works offers a new one (signed in) or the login.
 */
export function VerifyEmail({
  kind,
  token,
  continueHref,
  signedIn,
}: {
  kind: AccountKind
  token: string
  continueHref: string
  /** Signed in with an unconfirmed email: a dead link can be replaced right here. */
  signedIn: boolean
}) {
  const t = useTranslations("account.verify")
  const [state, setState] = useState<State>(token ? "checking" : "failed")
  const [message, setMessage] = useState<string | null>(null)
  const [sending, startSending] = useTransition()
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    verify[kind]({ token })
      .then((result) => setState(result?.ok ? "done" : "failed"))
      .catch(() => setState("failed"))
  }, [kind, token])

  function sendAgain() {
    startSending(async () => {
      try {
        const result = await resend[kind]({})
        if (!result) return
        if (result.ok) setMessage(result.data.verified ? t("doneTitle") : t("sent"))
        else setMessage(result.error)
      } catch {
        setMessage(t("errors.notSent"))
      }
    })
  }

  if (state === "checking") {
    return (
      <div role="status" className="text-muted-foreground flex flex-col items-center gap-4 py-6 text-center">
        <Spinner className="size-8" />
        <p className="text-base">{t("checking")}</p>
      </div>
    )
  }

  if (state === "done") {
    return (
      <div role="status" className="animate-in fade-in-0 flex flex-col items-center gap-5 text-center">
        <span className="bg-success/10 text-success flex size-14 items-center justify-center rounded-2xl">
          <CircleCheckIcon className="size-7" />
        </span>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-balance">{t("doneTitle")}</h2>
          <p className="text-muted-foreground text-pretty">{t(kind === "member" ? "doneText" : "doneTextInstructor")}</p>
        </div>
        <Button asChild size="lg" className="h-12 w-full rounded-xl text-base">
          <Link href={continueHref}>{t(kind === "member" ? "continue" : "continueInstructor")}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="animate-in fade-in-0 flex flex-col items-center gap-5 text-center">
      <span className="bg-warning/10 text-warning flex size-14 items-center justify-center rounded-2xl">
        <MailWarningIcon className="size-7" />
      </span>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-balance">{t("failedTitle")}</h2>
        <p className="text-muted-foreground text-pretty">{t(signedIn ? "failedText" : "failedTextSignedOut")}</p>
      </div>
      {message && (
        <p role="status" className="bg-muted rounded-xl px-4 py-3 text-sm text-pretty">
          {message}
        </p>
      )}
      {signedIn ? (
        <Button size="lg" className="h-12 w-full rounded-xl text-base" onClick={sendAgain} disabled={sending}>
          {sending ? <Spinner /> : <SendIcon className="rtl:-scale-x-100" />}
          {t("resend")}
        </Button>
      ) : (
        <Button asChild size="lg" className="h-12 w-full rounded-xl text-base">
          <Link href={loginPage[kind]}>{t("logIn")}</Link>
        </Button>
      )}
    </div>
  )
}
