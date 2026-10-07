"use client"

import { ArrowLeftIcon, MailCheckIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"

import { Form } from "@/components/admin/form/form"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { requestInstructorResetAction, requestMemberResetAction } from "@/features/accounts/actions"
import { accountForgotSchema } from "@/features/accounts/schema"
import { BigSubmit, EmailField, FormAlert } from "./fields"
import type { AccountKind } from "./login-form"
import { useSiteForm } from "./use-site-form"

const actions = { member: requestMemberResetAction, instructor: requestInstructorResetAction }
const loginPage = { member: "/account/login", instructor: "/instructor/login" }
/** Texts: the member's site, or the instructor's sign-in pages. */
const namespace = { member: "account.forgot", instructor: "auth.instructor.forgot" } as const

/** The email form, then the same "check your inbox" answer whether or not the address has an account. */
export function ForgotForm({ kind, minutes }: { kind: AccountKind; minutes: number }) {
  const t = useTranslations(namespace[kind])
  const tf = useTranslations("account.form")
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { form, submit, pending, error } = useSiteForm({
    schema: accountForgotSchema,
    action: actions[kind],
    defaultValues: { email: "" },
    onSuccess: () => setSentTo(form.getValues("email").trim()),
  })

  const back = (
    <Button asChild variant="ghost" className="text-muted-foreground h-11 w-full text-base">
      <Link href={loginPage[kind]}>
        <ArrowLeftIcon className="rtl:rotate-180" />
        {t("back")}
      </Link>
    </Button>
  )

  if (sentTo) {
    return (
      <div role="status" className="animate-in fade-in-0 flex flex-col items-center gap-4 text-center">
        <span className="bg-success/10 text-success flex size-14 items-center justify-center rounded-2xl">
          <MailCheckIcon className="size-7" />
        </span>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{t("sentTitle")}</h2>
          <p className="text-muted-foreground text-pretty">
            {/* U+2068 / U+2069 isolate the address, so it reads correctly inside Persian text. */}
            {t("sent", { email: `⁨${sentTo}⁩`, minutes })}
          </p>
        </div>
        {back}
      </div>
    )
  }

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <EmailField label={tf("email")} autoFocus />
      {error && <FormAlert>{error}</FormAlert>}
      <BigSubmit pending={pending}>{t("submit")}</BigSubmit>
      {back}
    </Form>
  )
}
