"use client"

import { useTranslations } from "next-intl"

import { Form, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { resetAdminPasswordAction } from "@/lib/auth/actions"
import { resetPasswordSchema } from "@/lib/auth/schemas"

/** New password + confirmation. On success the action goes back to the sign-in page. */
export function ResetForm({ token, minLength }: { token: string; minLength: number }) {
  const t = useTranslations("auth")
  const { form, submit, pending } = useActionForm({
    schema: resetPasswordSchema,
    action: resetAdminPasswordAction,
    defaultValues: { token, next: "", confirm: "" },
    successMessage: false,
  })

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <TextField
        name="next"
        label={t("password.next")}
        description={t("password.nextHint", { min: minLength })}
        type="password"
        autoComplete="new-password"
        dir="ltr"
        maxLength={256}
        className="[&_input]:h-10"
        autoFocus
      />
      <TextField
        name="confirm"
        label={t("password.confirm")}
        type="password"
        autoComplete="new-password"
        dir="ltr"
        maxLength={256}
        className="[&_input]:h-10"
      />
      <SubmitButton pending={pending} className="h-10 w-full">
        {t("reset.submit")}
      </SubmitButton>
    </Form>
  )
}
