"use client"

import { ArrowLeftIcon, MailCheckIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"

import { Form, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { requestAdminPasswordResetAction } from "@/lib/auth/actions"
import { forgotPasswordSchema } from "@/lib/auth/schemas"

/** The email form, then the same "check your inbox" answer whether or not the address is known. */
export function ForgotForm({ minutes }: { minutes: number }) {
  const t = useTranslations("auth.forgot")
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { form, submit, pending } = useActionForm({
    schema: forgotPasswordSchema,
    action: requestAdminPasswordResetAction,
    defaultValues: { email: "" },
    successMessage: false,
    onSuccess: () => setSentTo(form.getValues("email").trim()),
  })

  const back = (
    <Button asChild variant="ghost" className="text-muted-foreground w-full">
      <Link href="/admin/login">
        <ArrowLeftIcon className="rtl:rotate-180" />
        {t("back")}
      </Link>
    </Button>
  )

  if (sentTo) {
    return (
      <div role="status" className="animate-in fade-in-0 flex flex-col items-center gap-4 text-center">
        <span className="bg-success/10 text-success flex size-12 items-center justify-center rounded-2xl">
          <MailCheckIcon className="size-6" />
        </span>
        <div className="space-y-1.5">
          <h2 className="font-semibold">{t("sentTitle")}</h2>
          <p className="text-muted-foreground text-sm text-pretty">
            {/* U+2068 / U+2069 isolate the address, so it reads correctly inside Persian text. */}
            {t("sent", { email: `\u2068${sentTo}\u2069`, minutes })}
          </p>
        </div>
        {back}
      </div>
    )
  }

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <TextField
        name="email"
        label={t("email")}
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        dir="ltr"
        maxLength={254}
        className="[&_input]:h-10"
        autoFocus
      />
      <SubmitButton pending={pending} className="h-10 w-full">
        {t("submit")}
      </SubmitButton>
      {back}
    </Form>
  )
}
