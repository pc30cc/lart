"use client"

import { useTranslations } from "next-intl"

import { Form } from "@/components/admin/form/form"
import { memberSignupAction } from "@/features/accounts/actions"
import { signupSchema } from "@/features/accounts/schema"
import { BigSubmit, BigTextField, EmailField, FormAlert, PasswordField } from "./fields"
import { useSiteForm } from "./use-site-form"

/**
 * Name, email, password and an optional phone. The action signs the new
 * member in and goes straight back to `next` with a "check your inbox" notice.
 */
export function SignupForm({ next, minLength }: { next?: string; minLength: number }) {
  const t = useTranslations("account")
  const { form, submit, pending, error } = useSiteForm({
    schema: signupSchema,
    action: memberSignupAction,
    defaultValues: { name: "", email: "", password: "", phone: "", next },
  })

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <BigTextField name="name" label={t("signup.name")} autoComplete="name" maxLength={80} autoFocus />
      <EmailField label={t("form.email")} />
      <PasswordField
        label={t("form.password")}
        description={t("form.newPasswordHint", { min: minLength })}
        autoComplete="new-password"
      />
      <BigTextField
        name="phone"
        label={
          <>
            {t("signup.phone")} <span className="text-muted-foreground font-normal">({t("signup.optional")})</span>
          </>
        }
        description={t("signup.phoneHint")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        maxLength={40}
      />
      {error && <FormAlert>{error}</FormAlert>}
      <BigSubmit pending={pending}>{t("signup.submit")}</BigSubmit>
    </Form>
  )
}
