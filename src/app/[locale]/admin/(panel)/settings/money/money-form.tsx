"use client"

import { LockIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { Form, FormActions, FormField, FormSection, SubmitButton } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Switch } from "@/components/ui/switch"
import { saveMoneySettings } from "@/features/settings/money-actions"
import { moneySettingsSchema, type MoneySettingsValues } from "@/features/settings/money-schema"
import { formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The partners' profit shares (fixed: shown, never edited), the one partner
 * who pays the business's costs from the wallet (large choices), and whether
 * a partner may take money out of it (a switch, off).
 */
export function MoneySettingsForm({
  saved,
  partners,
}: {
  saved: MoneySettingsValues
  partners: { id: string; name: string; shareBp: number }[]
}) {
  const t = useTranslations("settings.money")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { form, submit, pending } = useActionForm({
    schema: moneySettingsSchema,
    action: saveMoneySettings,
    defaultValues: saved,
    successMessage: ts("toast.saved"),
    onSuccess: () => form.reset(form.getValues()),
  })

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("shares.title")} description={t("shares.description")}>
        <ul className="divide-y rounded-xl border">
          {partners.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="text-muted-foreground inline-flex items-center gap-1.5">
                <LockIcon className="size-3.5" aria-hidden />
                <span className="text-foreground text-base font-semibold tabular-nums">{formatPercent(p.shareBp / 10000, locale, 2)}</span>
              </span>
            </li>
          ))}
        </ul>
      </FormSection>

      <FormSection title={t("spender.title")} description={t("spender.description")}>
        <FormField<MoneySettingsValues> name="spenderId" label={t("spender.label")}>
          {(field) => (
            <div role="radiogroup" id={field.id} aria-describedby={field["aria-describedby"]} className="grid gap-2 sm:grid-cols-2">
              {[{ id: "", name: t("spender.nobody") }, ...partners].map((p, i) => {
                const checked = field.value === p.id
                return (
                  <button
                    key={p.id || "nobody"}
                    ref={i === 0 ? field.ref : undefined}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => {
                      field.onChange(p.id)
                      field.onBlur()
                    }}
                    className={cn(
                      "focus-visible:ring-ring/50 flex h-12 items-center gap-3 rounded-xl border px-4 text-start text-sm font-medium transition-colors outline-none focus-visible:ring-3",
                      checked ? "border-primary bg-primary/8 text-foreground" : "hover:bg-muted/60 text-muted-foreground",
                      !p.id && "font-normal",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", checked && "border-primary")}
                    >
                      {checked && <span className="bg-primary size-2 rounded-full" />}
                    </span>
                    {p.name}
                  </button>
                )
              })}
            </div>
          )}
        </FormField>
      </FormSection>

      <FormSection title={t("withdrawals.title")} description={t("withdrawals.description")}>
        <FormField<MoneySettingsValues> name="withdrawals">
          {(field) => (
            <label className="flex items-start justify-between gap-4 rounded-xl border p-4">
              <span className="space-y-1">
                <span className="block text-sm font-medium">{t("withdrawals.label")}</span>
                <span className="text-muted-foreground block text-sm text-pretty">{t("withdrawals.hint")}</span>
              </span>
              <Switch
                id={field.id}
                ref={field.ref}
                checked={Boolean(field.value)}
                onCheckedChange={(v) => {
                  field.onChange(v)
                  field.onBlur()
                }}
              />
            </label>
          )}
        </FormField>
      </FormSection>

      <FormActions>
        <SubmitButton pending={pending} disabled={!form.formState.isDirty}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}
