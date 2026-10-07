"use client"

import { HandshakeIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useId } from "react"

import { Form, SubmitButton } from "@/components/admin/form/form"
import { PasswordField } from "@/components/admin/form/password-field"
import { FormAlert } from "@/components/site/auth/fields"
import { useSiteForm } from "@/components/site/auth/use-site-form"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { acceptPartnerInviteAction } from "@/features/partners/actions"
import { acceptPartnerInviteSchema, type AcceptPartnerInviteValues } from "@/features/partners/schema"

/**
 * The invitation's form: the email (read-only: it is the one invited, and lets
 * the password manager save the password with it) and a new password. On
 * success the action signs the new partner in and goes to the panel. A problem
 * (the link no longer works, the team is full) shows above the button.
 */
export function AcceptForm({ token, email, minLength }: { token: string; email: string; minLength: number }) {
  const t = useTranslations("partners.accept")
  const emailId = useId()
  const { form, submit, pending, error } = useSiteForm({
    schema: acceptPartnerInviteSchema,
    action: acceptPartnerInviteAction,
    defaultValues: { token, password: "" },
  })

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <Field>
        <FieldLabel htmlFor={emailId}>{t("email")}</FieldLabel>
        <Input
          id={emailId}
          name="username"
          type="email"
          autoComplete="username"
          value={email}
          readOnly
          dir="ltr"
          className="bg-muted/50 text-muted-foreground h-10 focus-visible:ring-0"
        />
      </Field>
      <PasswordField<AcceptPartnerInviteValues>
        name="password"
        label={t("password")}
        description={t("passwordHint", { min: minLength })}
        autoComplete="new-password"
        autoFocus
      />
      {error && <FormAlert>{error}</FormAlert>}
      <SubmitButton pending={pending} className="h-10 w-full">
        {!pending && <HandshakeIcon />}
        {t("submit")}
      </SubmitButton>
      <p className="text-muted-foreground text-center text-xs text-pretty">{t("shareNote")}</p>
    </Form>
  )
}
