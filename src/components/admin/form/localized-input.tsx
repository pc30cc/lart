"use client"

import { CheckIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useId, useState } from "react"
import { Controller, useFormContext, useWatch } from "react-hook-form"

import { RequiredMark, useErrorText } from "@/components/admin/form/form"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { Locale, LocalizedText } from "@/db/schema"
import { cn } from "@/lib/utils"

const LOCALES: Locale[] = ["fa", "tr", "en"]

type Props = {
  /** Form field holding a `LocalizedText` ({ fa, tr, en }). */
  name: string
  label: React.ReactNode
  description?: React.ReactNode
  /** Locales that must be filled (marked with *). Match the schema's `localizedText({ required })`. */
  required?: readonly Locale[]
  placeholder?: string
  maxLength?: number
  className?: string
}

/** One text in three languages: FA / TR / EN tabs that show which ones are filled. */
export function LocalizedInput(props: Props) {
  return <LocalizedField {...props} multiline={false} />
}

/** Like LocalizedInput, with a growing textarea for longer text. */
export function LocalizedTextarea(props: Props & { rows?: number }) {
  return <LocalizedField {...props} multiline />
}

function LocalizedField({
  name,
  label,
  description,
  required = [],
  placeholder,
  maxLength,
  className,
  multiline,
  rows,
}: Props & { multiline: boolean; rows?: number }) {
  const t = useTranslations("common")
  const uiLocale = useLocale() as Locale
  const id = useId()
  const { control, getFieldState, formState } = useFormContext()
  const value = (useWatch({ control, name }) ?? {}) as LocalizedText

  const errors = LOCALES.map((l) => ({ locale: l, message: getFieldState(`${name}.${l}`, formState).error?.message }))
  const errorLocales = errors.filter((e) => e.message).map((e) => e.locale)
  const [active, setActive] = useState<Locale>(LOCALES.includes(uiLocale) ? uiLocale : "fa")

  // When validation fails on a hidden language, show that tab.
  const errorKey = errorLocales.join()
  const [seenErrors, setSeenErrors] = useState(errorKey)
  if (errorKey !== seenErrors) {
    setSeenErrors(errorKey)
    if (errorLocales.length && !errorLocales.includes(active)) setActive(errorLocales[0])
  }

  const filled = LOCALES.filter((l) => value[l]?.trim()).length

  return (
    <Field data-invalid={errorLocales.length > 0} className={className}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={`${id}-${active}`} className="gap-1">
          {label}
          {required.length > 0 && <RequiredMark />}
        </FieldLabel>
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("form.languagesFilled", { count: filled, total: LOCALES.length })}
        </span>
      </div>

      <Tabs value={active} onValueChange={(v) => setActive(v as Locale)} className="gap-2">
        <TabsList className="h-8 w-full sm:w-fit">
          {LOCALES.map((l) => {
            const isFilled = Boolean(value[l]?.trim())
            const hasError = errorLocales.includes(l)
            return (
              <TabsTrigger key={l} value={l} className="gap-1.5 px-2.5" aria-invalid={hasError || undefined}>
                <span
                  aria-hidden
                  className={cn(
                    "flex size-3.5 items-center justify-center rounded-full",
                    hasError
                      ? "bg-destructive"
                      : isFilled
                        ? "bg-success text-background"
                        : "border-muted-foreground/40 border border-dashed",
                  )}
                >
                  {isFilled && !hasError && <CheckIcon className="size-2.5! stroke-3" />}
                </span>
                <span lang={l}>{t(`locales.${l}`)}</span>
                {required.includes(l) && (
                  <span aria-hidden className="text-primary">
                    *
                  </span>
                )}
                <span className="sr-only">
                  {hasError ? t("form.hasError") : isFilled ? t("form.filled") : t("form.missing")}
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>

        {LOCALES.map((l) => (
          <div key={l} hidden={l !== active}>
            <Controller
              control={control}
              name={`${name}.${l}`}
              render={({ field, fieldState }) => {
                const common = {
                  id: `${id}-${l}`,
                  name: field.name,
                  ref: field.ref,
                  value: (field.value as string | undefined) ?? "",
                  onChange: field.onChange,
                  onBlur: field.onBlur,
                  lang: l,
                  dir: l === "fa" ? "rtl" : "ltr",
                  placeholder,
                  maxLength,
                  required: required.includes(l),
                  "aria-invalid": Boolean(fieldState.error),
                  "aria-describedby": description ? `${id}-desc` : undefined,
                } as const
                return multiline ? (
                  <Textarea {...common} rows={rows ?? 4} className={cn(l === "fa" && "font-(family-name:--font-iransans)")} />
                ) : (
                  <Input {...common} className={cn(l === "fa" && "font-(family-name:--font-iransans)")} />
                )
              }}
            />
          </div>
        ))}
      </Tabs>

      {description && (
        <FieldDescription id={`${id}-desc`} className="text-start">
          {description}
        </FieldDescription>
      )}
      <LocalizedErrors errors={errors} />
    </Field>
  )
}

function LocalizedErrors({ errors }: { errors: { locale: Locale; message?: string }[] }) {
  const shown = errors.filter((e) => e.message)
  if (!shown.length) return null
  return (
    <ul role="alert" className="text-destructive space-y-0.5 text-sm">
      {shown.map((e) => (
        <LocalizedError key={e.locale} locale={e.locale} message={e.message!} />
      ))}
    </ul>
  )
}

function LocalizedError({ locale, message }: { locale: Locale; message: string }) {
  const t = useTranslations("common")
  const text = useErrorText(message)
  return (
    <li>
      <span className="font-medium">{t(`locales.${locale}`)}:</span> {text}
    </li>
  )
}
