"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { useTransition } from "react"
import { useForm, type DefaultValues, type FieldValues, type Path } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"

import { zodIssueMessage, type ActionResult } from "@/lib/errors"

/**
 * react-hook-form + an `adminAction`, wired together:
 * - validates on the client with the same Zod schema (translated messages),
 * - sends the raw values to the server action (which validates again),
 * - shows a success toast, or puts the server's field errors on the fields
 *   and the friendly error in a toast.
 *
 *   const { form, submit, pending } = useActionForm({
 *     schema: categorySchema, action: createCategory,
 *     defaultValues: { name: {}, slug: "", sort: 0 },
 *     successMessage: t("toast.created"),
 *     onSuccess: () => router.push("/admin/categories"),
 *   })
 *   <Form form={form} onSubmit={submit}> ... <SubmitButton pending={pending}>...</SubmitButton></Form>
 */
export function useActionForm<S extends z.ZodType<FieldValues, FieldValues>, T>({
  schema,
  action,
  defaultValues,
  successMessage,
  onSuccess,
}: {
  schema: S
  action: (input: z.input<S>) => Promise<ActionResult<T>>
  defaultValues: DefaultValues<z.input<S>>
  /** Toast text on success; defaults to "Saved". `false` for none. */
  successMessage?: string | false
  onSuccess?: (data: T) => void
}) {
  const t = useTranslations("common")
  const [pending, startTransition] = useTransition()
  const form = useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema, { error: (issue) => zodIssueMessage(issue, (key, values) => t(key, values)) }),
    defaultValues,
    mode: "onTouched",
  })

  const submit = form.handleSubmit(
    () =>
      new Promise<void>((resolve) => {
        startTransition(async () => {
          try {
            const result = await action(form.getValues())
            if (!result) return // the action redirected
            if (result.ok) {
              if (successMessage !== false) toast.success(successMessage ?? t("toast.saved"))
              onSuccess?.(result.data)
            } else {
              const entries = Object.entries(result.fieldErrors ?? {})
              entries.forEach(([path, message], i) =>
                form.setError(path as Path<z.input<S>>, { type: "server", message }, { shouldFocus: i === 0 }),
              )
              toast.error(result.error)
            }
          } catch {
            toast.error(t("errors.network"))
          } finally {
            resolve()
          }
        })
      }),
  )

  return { form, submit, pending }
}
