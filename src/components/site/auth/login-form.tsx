"use client"

import { useTranslations } from "next-intl"

import { Form } from "@/components/admin/form/form"
import { Link } from "@/i18n/navigation"
import { instructorLoginAction, memberLoginAction } from "@/features/accounts/actions"
import { accountLoginSchema } from "@/features/accounts/schema"
import { BigSubmit, EmailField, FormAlert, FormNotice, PasswordField } from "./fields"
import { useSiteForm } from "./use-site-form"

export type AccountKind = "member" | "instructor"

const actions = { member: memberLoginAction, instructor: instructorLoginAction }
const forgotPage = { member: "/account/forgot", instructor: "/instructor/forgot" }

/**
 * Email + password. On success the action signs in and goes on to `next`
 * (a member: back to the site; an instructor: into the panel).
 */
export function LoginForm({ kind, next, notice }: { kind: AccountKind; next?: string; notice?: string }) {
  const t = useTranslations("account")
  const { form, submit, pending, error } = useSiteForm({
    schema: accountLoginSchema,
    action: actions[kind],
    defaultValues: { email: "", password: "", next },
  })

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      {notice && !error && <FormNotice>{notice}</FormNotice>}
      <EmailField label={t("form.email")} autoFocus />
      <div className="space-y-2">
        <PasswordField label={t("form.password")} autoComplete="current-password" />
        <p className="text-end text-sm">
          <Link
            href={forgotPage[kind]}
            className="text-muted-foreground hover:text-primary focus-visible:ring-ring/50 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3"
          >
            {t("login.forgot")}
          </Link>
        </p>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      <BigSubmit pending={pending}>{t("login.submit")}</BigSubmit>
    </Form>
  )
}
