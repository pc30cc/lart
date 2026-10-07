"use client"

import { CircleAlertIcon, CircleCheckIcon, EyeIcon, EyeOffIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"

import { FormField, SubmitButton, TextField } from "@/components/admin/form/form"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** Large, phone-friendly inputs and buttons for the site's account forms. */
const big = "[&_input]:h-12 [&_input]:text-base [&_label]:text-base"

/** A problem with the whole form, in friendly words, right above the button. */
export function FormAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="bg-destructive/8 text-destructive animate-in fade-in-0 flex gap-2.5 rounded-xl p-3.5 text-sm leading-relaxed"
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <p className="text-pretty">{children}</p>
    </div>
  )
}

/** A short good-news line (e.g. "You're signed out"). */
export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="bg-success/10 text-success flex gap-2.5 rounded-xl p-3.5 text-sm leading-relaxed">
      <CircleCheckIcon className="mt-0.5 size-4 shrink-0" />
      <p className="text-pretty">{children}</p>
    </div>
  )
}

export function EmailField({ label, autoFocus }: { label: string; autoFocus?: boolean }) {
  return (
    <TextField
      name="email"
      label={label}
      type="email"
      inputMode="email"
      autoComplete="email"
      autoCapitalize="none"
      spellCheck={false}
      dir="ltr"
      maxLength={254}
      className={big}
      autoFocus={autoFocus}
    />
  )
}

export function BigTextField(props: React.ComponentProps<typeof TextField>) {
  return <TextField {...props} className={cn(big, props.className)} />
}

/** A password input with a "show password" eye, so nobody has to type it twice. */
export function PasswordField({
  name = "password",
  label,
  description,
  autoComplete,
  autoFocus,
}: {
  name?: string
  label: string
  description?: React.ReactNode
  autoComplete: "current-password" | "new-password"
  autoFocus?: boolean
}) {
  const t = useTranslations("account.form")
  const [show, setShow] = useState(false)

  return (
    <FormField name={name} label={label} description={description} className={big}>
      {({ value, ...field }) => (
        <div className="relative" dir="ltr">
          <Input
            {...field}
            ref={field.ref}
            value={(value as string | undefined) ?? ""}
            type={show ? "text" : "password"}
            autoComplete={autoComplete}
            autoCapitalize="none"
            spellCheck={false}
            maxLength={256}
            autoFocus={autoFocus}
            className="pe-12"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? t("hidePassword") : t("showPassword")}
            aria-pressed={show}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute end-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg outline-none focus-visible:ring-3"
          >
            {show ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
          </button>
        </div>
      )}
    </FormField>
  )
}

/** The form's one main button: full width and easy to tap. */
export function BigSubmit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <SubmitButton pending={pending} className="h-12 w-full rounded-xl text-base">
      {children}
    </SubmitButton>
  )
}
