"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { useForm, type DefaultValues, type FieldValues, type Path } from "react-hook-form"
import type { z } from "zod"

import { zodIssueMessage, type ActionResult } from "@/lib/errors"

/**
 * react-hook-form + a public or member server action, for the site's forms
 * (sign up, log in, passwords). Like `useActionForm`, but a problem is shown
 * in the form itself (`error`, next to the button) instead of a toast, which
 * is easy to miss on a phone. Actions that sign someone in redirect; then
 * there is no result to handle.
 */
export function useSiteForm<S extends z.ZodType<FieldValues, FieldValues>, T>({
  schema,
  action,
  defaultValues,
  onSuccess,
}: {
  schema: S
  action: (input: z.input<S>) => Promise<ActionResult<T>>
  defaultValues: DefaultValues<z.input<S>>
  onSuccess?: (data: T) => void
}) {
  const t = useTranslations("common")
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema, { error: (issue) => zodIssueMessage(issue, (key, values) => t(key, values)) }),
    defaultValues,
    // First check on submit, then as the visitor types. Not on blur: the first
    // field is focused, and an error line appearing when the visitor clicks a
    // link under the form would move the link away and lose the click.
    mode: "onSubmit",
    reValidateMode: "onChange",
  })

  const submit = form.handleSubmit(
    () =>
      new Promise<void>((resolve) => {
        setError(null)
        startTransition(async () => {
          try {
            const result = await action(form.getValues())
            if (!result) return // the action redirected
            if (result.ok) {
              onSuccess?.(result.data)
              return
            }
            const fields = Object.entries(result.fieldErrors ?? {})
            fields.forEach(([path, message], i) =>
              form.setError(path as Path<z.input<S>>, { type: "server", message }, { shouldFocus: i === 0 }),
            )
            if (!fields.length) setError(result.error)
          } catch {
            setError(t("errors.network"))
          } finally {
            resolve()
          }
        })
      }),
  )

  return { form, submit, pending, error }
}
