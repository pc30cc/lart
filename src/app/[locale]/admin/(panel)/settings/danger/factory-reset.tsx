"use client"

import { CircleCheckIcon, TrashIcon, TriangleAlertIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"
import { useWatch } from "react-hook-form"

import { Form, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import type { ResetCounts } from "@/features/settings/reset"
import { factoryReset } from "@/features/settings/reset-actions"
import { factoryResetSchema, type FactoryResetValues } from "@/features/settings/reset-schema"
import { formatNumber } from "@/lib/format"

/**
 * The danger zone: a red card saying what "Delete all transactions" removes
 * (with today's counts) and what stays, and a button that opens the
 * confirmation (the admin's password and the phrase typed out).
 */
export function FactoryReset({ counts }: { counts: ResetCounts }) {
  const t = useTranslations("settings.danger")
  const locale = useLocale()
  const n = (value: number) => formatNumber(value, locale)
  const [open, setOpen] = useState(false)

  return (
    <section aria-labelledby="danger-reset" className="border-destructive/40 bg-destructive/[0.03] max-w-3xl rounded-2xl border">
      <div className="flex items-start gap-4 p-5 sm:p-6">
        <span className="bg-destructive/10 text-destructive flex size-10 shrink-0 items-center justify-center rounded-full">
          <TriangleAlertIcon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1.5">
          <h2 id="danger-reset" className="text-lg font-semibold">
            {t("reset.title")}
          </h2>
          <p className="text-muted-foreground text-sm text-pretty">{t("reset.description")}</p>
        </div>
      </div>

      <div className="grid gap-4 border-t border-destructive/20 p-5 sm:grid-cols-2 sm:p-6">
        <div>
          <h3 className="text-destructive text-sm font-semibold">{t("reset.removedTitle")}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex gap-2">
              <TrashIcon className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
              {t("reset.removed.transactions", { count: counts.transactions, n: n(counts.transactions) })}
            </li>
            <li className="flex gap-2">
              <TrashIcon className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
              {t("reset.removed.contracts", { count: counts.contracts, n: n(counts.contracts) })}
            </li>
            <li className="flex gap-2">
              <TrashIcon className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
              {t("reset.removed.audit", { count: counts.auditRows, n: n(counts.auditRows) })}
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("reset.keptTitle")}</h3>
          <ul className="text-muted-foreground mt-3 space-y-2 text-sm">
            {(["people", "workshops", "heldContracts", "settings"] as const).map((key) => (
              <li key={key} className="flex gap-2">
                <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                {t(`reset.kept.${key}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-destructive/20 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <p className="text-muted-foreground text-sm text-pretty">{t("reset.irreversible")}</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" size="lg" className="shrink-0 px-4">
              <TrashIcon />
              {t("reset.button")}
            </Button>
          </DialogTrigger>
          <DialogContent showCloseButton={false} className="gap-5 p-5 sm:max-w-md">
            <DialogHeader className="text-start">
              <DialogTitle className="text-lg">{t("confirm.title")}</DialogTitle>
              <DialogDescription className="text-pretty">{t("confirm.description")}</DialogDescription>
            </DialogHeader>
            <ConfirmForm close={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>
    </section>
  )
}

/** The password and the phrase; the button stays off until the phrase is typed. */
function ConfirmForm({ close }: { close: () => void }) {
  const t = useTranslations("settings.danger")
  const tc = useTranslations("common")
  const { form, submit, pending } = useActionForm({
    schema: factoryResetSchema,
    action: factoryReset,
    defaultValues: { password: "", confirm: "" },
    successMessage: t("done"),
    onSuccess: close,
  })
  const typed = useWatch({ control: form.control, name: "confirm" })
  const phrase = t("confirmPhrase")

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <TextField<FactoryResetValues>
        name="confirm"
        label={t.rich("confirm.phraseLabel", { phrase: () => <strong className="text-foreground select-all">{phrase}</strong> })}
        required
        autoComplete="off"
        spellCheck={false}
      />
      <TextField<FactoryResetValues> name="password" type="password" label={t("confirm.password")} required autoComplete="current-password" />
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="lg" disabled={pending}>
            {tc("actions.cancel")}
          </Button>
        </DialogClose>
        <SubmitButton variant="destructive" pending={pending} disabled={!typed.trim()}>
          {t("confirm.submit")}
        </SubmitButton>
      </div>
    </Form>
  )
}
