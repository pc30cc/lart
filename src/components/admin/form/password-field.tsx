"use client"

import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import type { FieldPath, FieldValues } from "react-hook-form"

import { FormField } from "@/components/admin/form/form"
import { Input } from "@/components/ui/input"

/** A password input (react-hook-form) with a "show password" eye, so nobody has to type it twice. */
export function PasswordField<T extends FieldValues = FieldValues>({
  name,
  label,
  description,
  autoComplete,
  autoFocus,
  className,
}: {
  name: FieldPath<T>
  label: string
  description?: React.ReactNode
  autoComplete: "current-password" | "new-password"
  autoFocus?: boolean
  className?: string
}) {
  const t = useTranslations("auth.login")
  const [show, setShow] = useState(false)

  return (
    <FormField<T> name={name} label={label} description={description} className={className}>
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
            className="h-10 pe-10"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? t("hidePassword") : t("showPassword")}
            aria-pressed={show}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute end-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md outline-none focus-visible:ring-3"
          >
            {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      )}
    </FormField>
  )
}
