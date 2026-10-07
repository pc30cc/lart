"use client"

import { useTranslations } from "next-intl"

import { Form } from "@/components/admin/form/form"
import {
  acceptInviteAction,
  resetInstructorPasswordAction,
  resetMemberPasswordAction,
} from "@/features/accounts/actions"
import { accountPasswordSchema } from "@/features/accounts/schema"
import { BigSubmit, FormAlert, PasswordField } from "./fields"
import { useSiteForm } from "./use-site-form"

/** What the password is for: a member's or an instructor's reset link, or an instructor's invitation. */
export type PasswordPurpose = "member-reset" | "instructor-reset" | "invite"

const actions = {
  "member-reset": resetMemberPasswordAction,
  "instructor-reset": resetInstructorPasswordAction,
  invite: acceptInviteAction,
}

/**
 * One new password (with a "show" eye instead of typing it twice). On success
 * the action signs this device in and goes on: back to the site, or into the
 * instructor panel.
 */
export function NewPasswordForm({
  purpose,
  token,
  minLength,
  label,
  submitLabel,
  username,
}: {
  purpose: PasswordPurpose
  token: string
  minLength: number
  label: string
  submitLabel: string
  /** The account's email, when known: lets the browser's password manager save the new password with it. */
  username?: string
}) {
  const t = useTranslations("account.form")
  const { form, submit, pending, error } = useSiteForm({
    schema: accountPasswordSchema,
    action: actions[purpose],
    defaultValues: { token, password: "" },
  })

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      {username && (
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={username}
          readOnly
          tabIndex={-1}
          aria-hidden
          className="sr-only"
        />
      )}
      <PasswordField
        label={label}
        description={t("newPasswordHint", { min: minLength })}
        autoComplete="new-password"
        autoFocus
      />
      {error && <FormAlert>{error}</FormAlert>}
      <BigSubmit pending={pending}>{submitLabel}</BigSubmit>
    </Form>
  )
}
