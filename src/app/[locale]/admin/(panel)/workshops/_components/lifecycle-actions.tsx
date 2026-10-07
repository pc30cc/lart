"use client"

import { BanIcon, CircleCheckBigIcon, MailIcon, PrinterIcon, UserRoundPlusIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { Form, FormField, SubmitButton } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { resendContract } from "@/features/contracts/actions"
import { cancelWorkshop, confirmWorkshop, raiseFinalParticipants } from "@/features/workshops/actions"
import { raiseFinalSchema, type RaiseFinalValues } from "@/features/workshops/schema"
import { formatNumber } from "@/lib/format"

/** Go decision: confirm the workshop (fixes the number of participants). */
export function ConfirmWorkshopButton({
  id,
  title,
  confirmed,
  minimum,
}: {
  id: string
  title: string
  confirmed: number
  minimum: number
}) {
  const t = useTranslations("workshops.lifecycle")
  const locale = useLocale()
  return (
    <ConfirmAction
      action={confirmWorkshop}
      input={{ id }}
      destructive={false}
      title={t("confirm.title", { title })}
      description={
        <>
          {t("confirm.description", { count: confirmed })}
          {confirmed < minimum && (
            <span className="text-warning mt-2 block font-medium">
              {t("confirm.belowMinimum", { minimum: formatNumber(minimum, locale) })}
            </span>
          )}
        </>
      }
      confirmLabel={t("confirm.action")}
      successMessage={t("confirm.done")}
      trigger={
        <Button size="lg" className="px-4">
          <CircleCheckBigIcon />
          {t("confirm.trigger")}
        </Button>
      }
    />
  )
}

/**
 * After the go decision: the instructor agreed to more people (contract 5.2),
 * so the admin raises the final number (more than now, at most the maximum).
 */
export function RaiseFinalButton({ id, current, max }: { id: string; current: number; max: number }) {
  const t = useTranslations("workshops.lifecycle.raise")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="px-3">
          <UserRoundPlusIcon />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-5 p-5 sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg text-balance">{t("title")}</DialogTitle>
          <DialogDescription className="text-pretty">
            {t("description", { count: formatNumber(current, locale) })}
          </DialogDescription>
        </DialogHeader>
        {open && <RaiseFinalForm id={id} current={current} max={max} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function RaiseFinalForm({ id, current, max, onDone }: { id: string; current: number; max: number; onDone: () => void }) {
  const t = useTranslations("workshops.lifecycle.raise")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { form, submit, pending } = useActionForm({
    schema: raiseFinalSchema,
    action: raiseFinalParticipants,
    defaultValues: { id, finalParticipants: Math.min(current + 1, max) },
    successMessage: t("done"),
    onSuccess: onDone,
  })
  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <FormField<RaiseFinalValues>
        name="finalParticipants"
        label={t("field")}
        description={t("hint", { current: formatNumber(current, locale), max: formatNumber(max, locale) })}
        required
      >
        {({ value, onChange, ...field }) => (
          <Input
            {...field}
            ref={field.ref}
            type="number"
            inputMode="numeric"
            min={current + 1}
            max={max}
            step={1}
            dir="ltr"
            className="h-10 max-w-32 text-base tabular-nums"
            value={typeof value === "number" && Number.isFinite(value) ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        )}
      </FormField>
      <p className="text-muted-foreground text-sm text-pretty">{t("after")}</p>
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="lg" disabled={pending}>
            {tc("actions.cancel")}
          </Button>
        </DialogClose>
        <SubmitButton pending={pending}>{t("action")}</SubmitButton>
      </div>
    </Form>
  )
}

/** No-go / cancel: cancels every open registration and emails people who paid. */
export function CancelWorkshopButton({
  id,
  title,
  registrations,
  variant = "outline",
}: {
  id: string
  title: string
  registrations: number
  variant?: "outline" | "ghost"
}) {
  const t = useTranslations("workshops.lifecycle")
  return (
    <ConfirmAction
      action={cancelWorkshop}
      input={{ id }}
      title={t("cancel.title", { title })}
      description={t("cancel.description", { count: registrations })}
      confirmLabel={t("cancel.action")}
      successMessage={t("cancel.done")}
      trigger={
        <Button size="lg" variant={variant} className="text-destructive hover:text-destructive px-4">
          <BanIcon />
          {t("cancel.trigger")}
        </Button>
      }
    />
  )
}

/** Email the contract waiting for a signature to the instructor again. */
export function ResendContractButton({ courseId, variant = "outline" }: { courseId: string; variant?: "outline" | "ghost" }) {
  const t = useTranslations("workshops.lifecycle.resend")
  const tc = useTranslations("common")
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="lg"
      variant={variant}
      className="px-4"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const result = await resendContract({ courseId })
            if (!result) return
            if (result.ok) toast.success(t("done"))
            else toast.error(result.error)
          } catch {
            toast.error(tc("errors.network"))
          }
        })
      }
    >
      {pending ? <Spinner aria-hidden /> : <MailIcon />}
      {t("trigger")}
    </Button>
  )
}

export function PrintButton() {
  const t = useTranslations("workshops.contractPage")
  return (
    <Button variant="outline" size="lg" className="px-4" onClick={() => window.print()}>
      <PrinterIcon />
      {t("print")}
    </Button>
  )
}
