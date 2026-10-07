"use client"

import { CircleAlertIcon, CircleCheckIcon, EyeIcon, EyeOffIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { SubmitButton } from "@/components/admin/form/form"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Link } from "@/i18n/navigation"
import { adminLoginAction, type LoginState } from "@/lib/auth/actions"

/** `notice`: a success message to show above the form (e.g. after a password reset). */
export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const t = useTranslations("auth.login")
  const [state, formAction, pending] = useActionState<LoginState, FormData>(adminLoginAction, {})
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form action={formAction} className="space-y-5">
      {next && <input type="hidden" name="next" value={next} />}

      {notice && !state.error && (
        <div role="status" className="bg-success/10 text-success flex gap-2.5 rounded-lg p-3 text-sm">
          <CircleCheckIcon className="mt-0.5 size-4 shrink-0" />
          <p className="text-pretty">{notice}</p>
        </div>
      )}

      {state.error && (
        <div
          role="alert"
          className="bg-destructive/8 text-destructive animate-in fade-in-0 flex gap-2.5 rounded-lg p-3 text-sm"
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="text-pretty">{state.error}</p>
        </div>
      )}

      <Field>
        <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          required
          maxLength={254}
          defaultValue={state.email}
          key={state.email}
          aria-invalid={Boolean(state.error) || undefined}
          className="h-10"
          autoFocus
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
        <div className="relative" dir="ltr">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={256}
            aria-invalid={Boolean(state.error) || undefined}
            className="h-10 pe-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t("hidePassword") : t("showPassword")}
            aria-pressed={showPassword}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute end-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md outline-none focus-visible:ring-3"
          >
            {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      </Field>

      <SubmitButton pending={pending} className="h-10 w-full">
        {pending ? t("submitting") : t("submit")}
      </SubmitButton>

      <p className="text-center text-sm">
        <Link
          href="/admin/forgot"
          className="text-muted-foreground hover:text-primary rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t("forgot")}
        </Link>
      </p>
    </form>
  )
}
