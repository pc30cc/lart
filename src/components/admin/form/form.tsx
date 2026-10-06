"use client"

import { useTranslations } from "next-intl"
import { useId } from "react"
import { useFormStatus } from "react-dom"
import {
  FormProvider,
  useController,
  useFormContext,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { isMessageKey } from "@/lib/errors"
import { cn } from "@/lib/utils"

/** Translate an error that is a message key (from a schema); pass ready text through. */
export function useErrorText(message: string | undefined): string | undefined {
  const t = useTranslations()
  if (!message) return undefined
  return isMessageKey(message) && t.has(message) ? t(message) : message
}

/** <form> wired to react-hook-form. Use with `useActionForm`. */
export function Form<T extends FieldValues, C, O>({
  form,
  onSubmit,
  className,
  children,
}: {
  form: UseFormReturn<T, C, O>
  onSubmit: (event?: React.BaseSyntheticEvent) => Promise<void>
  className?: string
  children: React.ReactNode
}) {
  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={onSubmit} className={cn("space-y-8", className)}>
        {children}
      </form>
    </FormProvider>
  )
}

/** A titled group of fields: title + hint on the side (desktop), fields in a card. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8", className)}>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-muted-foreground text-sm text-pretty">{description}</p>}
      </div>
      <div className="bg-card ring-foreground/8 space-y-6 rounded-xl p-5 shadow-xs ring-1 md:p-6">{children}</div>
    </section>
  )
}

/** Bottom bar with the form's buttons, aligned to the end. */
export function FormActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t pt-6", className)}>{children}</div>
}

export function RequiredMark() {
  const t = useTranslations("common.form")
  return (
    <span className="text-primary" title={t("required")}>
      <span aria-hidden>*</span>
      <span className="sr-only">{t("required")}</span>
    </span>
  )
}

export type FieldControlProps = {
  id: string
  name: string
  value: unknown
  onChange: (...event: unknown[]) => void
  onBlur: () => void
  ref: React.RefCallback<HTMLElement>
  disabled?: boolean
  "aria-invalid": boolean
  "aria-describedby"?: string
}

/**
 * One labelled field with its description and (translated) error. The render
 * prop gets everything an input needs:
 *   <FormField name="sort" label={t("fields.sort")}>{(field) => <Input {...field} />}</FormField>
 */
export function FormField<T extends FieldValues = FieldValues>({
  name,
  label,
  description,
  required,
  className,
  children,
}: {
  name: FieldPath<T>
  label?: React.ReactNode
  description?: React.ReactNode
  required?: boolean
  className?: string
  children: (field: FieldControlProps) => React.ReactNode
}) {
  const id = useId()
  const { control } = useFormContext<T>()
  const { field, fieldState } = useController({ name, control })
  const error = useErrorText(fieldState.error?.message)
  const describedBy = [description && `${id}-desc`, error && `${id}-err`].filter(Boolean).join(" ") || undefined

  return (
    <Field data-invalid={Boolean(error)} className={className}>
      {label && (
        <FieldLabel htmlFor={id} className="gap-1">
          {label}
          {required && <RequiredMark />}
        </FieldLabel>
      )}
      {children({
        id,
        name: field.name,
        value: field.value,
        onChange: field.onChange,
        onBlur: field.onBlur,
        ref: field.ref,
        disabled: field.disabled,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
      })}
      {description && (
        <FieldDescription id={`${id}-desc`} className="text-start">
          {description}
        </FieldDescription>
      )}
      {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
    </Field>
  )
}

type InputProps = Omit<React.ComponentProps<"input">, "name" | "value" | "onChange" | "onBlur" | "ref">

/** A text-like input field (text, email, number, url, ...). */
export function TextField<T extends FieldValues = FieldValues>({
  name,
  label,
  description,
  required,
  className,
  ...input
}: {
  name: FieldPath<T>
  label?: React.ReactNode
  description?: React.ReactNode
  required?: boolean
  className?: string
} & InputProps) {
  return (
    <FormField<T> name={name} label={label} description={description} required={required} className={className}>
      {({ value, ...field }) => (
        <Input {...input} {...field} ref={field.ref} value={(value as string | number | undefined) ?? ""} />
      )}
    </FormField>
  )
}

type TextareaProps = Omit<React.ComponentProps<"textarea">, "name" | "value" | "onChange" | "onBlur" | "ref">

export function TextareaField<T extends FieldValues = FieldValues>({
  name,
  label,
  description,
  required,
  className,
  ...textarea
}: {
  name: FieldPath<T>
  label?: React.ReactNode
  description?: React.ReactNode
  required?: boolean
  className?: string
} & TextareaProps) {
  return (
    <FormField<T> name={name} label={label} description={description} required={required} className={className}>
      {({ value, ...field }) => (
        <Textarea {...textarea} {...field} ref={field.ref} value={(value as string | undefined) ?? ""} />
      )}
    </FormField>
  )
}

/**
 * Submit button with a spinner while pending. Pass `pending` from
 * `useActionForm`; inside a plain `<form action={...}>` it follows the form status.
 */
export function SubmitButton({
  pending,
  disabled,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  const status = useFormStatus()
  const busy = pending ?? status.pending
  return (
    <Button type="submit" size="lg" {...props} disabled={busy || disabled} aria-busy={busy} className={cn("px-4", className)}>
      {busy && <Spinner aria-hidden />}
      {children}
    </Button>
  )
}
