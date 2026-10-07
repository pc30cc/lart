"use client"

import {
  BanknoteIcon,
  BanIcon,
  CircleCheckBigIcon,
  CreditCardIcon,
  EllipsisIcon,
  LandmarkIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"
import type { FieldValues, Path, UseFormReturn } from "react-hook-form"

import { DateField, todayIso } from "@/app/[locale]/admin/(panel)/money/_components/fields"
import { Form, FormField, SubmitButton } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { formatPercent } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"
import { cancelPreview, isolate } from "../../schema"
import { cancelRegistrationAction, markRefundedAction, recordPaymentAction } from "../actions"
import {
  cancelRegistrationSchema,
  markRefundedSchema,
  recordPaymentSchema,
  type CancelRegistrationValues,
  type MarkRefundedValues,
  type PaymentMethod,
  type RecordPaymentValues,
} from "../schema"

/**
 * The super admin's dialogs for one registration: record its payment, cancel
 * it (with the refund choice), and mark its refund as paid back. Each one is
 * a small form that asks for confirmation with its big button; the server
 * checks everything again (amounts come from the database).
 */

const methodIcons: Record<PaymentMethod, LucideIcon> = { cash: BanknoteIcon, transfer: LandmarkIcon, online: CreditCardIcon }

/** Big radio cards (icon, title, a line of help), one per choice. */
function ChoiceList<V extends string>({
  id,
  value,
  onChange,
  choices,
  describedBy,
}: {
  id: string
  value: V
  onChange: (value: V) => void
  choices: { value: V; title: string; description?: string; icon?: LucideIcon }[]
  describedBy?: string
}) {
  return (
    <RadioGroup id={id} value={value} onValueChange={(v) => onChange(v as V)} aria-describedby={describedBy} className="gap-2">
      {choices.map((choice) => (
        <label
          key={choice.value}
          htmlFor={`${id}-${choice.value}`}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors",
            value === choice.value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
          )}
        >
          {choice.icon && <choice.icon className="text-muted-foreground size-5 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{choice.title}</span>
            {choice.description && <span className="text-muted-foreground block text-xs text-pretty">{choice.description}</span>}
          </span>
          <RadioGroupItem value={choice.value} id={`${id}-${choice.value}`} />
        </label>
      ))}
    </RadioGroup>
  )
}

function ChoiceField<T extends FieldValues, V extends string>({
  name,
  label,
  choices,
}: {
  name: Path<T>
  label: string
  choices: { value: V; title: string; description?: string; icon?: LucideIcon }[]
}) {
  return (
    <FormField<T> name={name} label={label} required>
      {(field) => (
        <ChoiceList
          id={field.id}
          value={field.value as V}
          describedBy={field["aria-describedby"]}
          onChange={(v) => {
            field.onChange(v)
            field.onBlur()
          }}
          choices={choices}
        />
      )}
    </FormField>
  )
}

/** A dialog with a title, a few lines and a form; Cancel / the confirm button at the bottom. */
function FormDialog<T extends FieldValues, C, O>({
  open,
  onOpenChange,
  title,
  description,
  form,
  submit,
  pending,
  submitLabel,
  destructive,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  form: UseFormReturn<T, C, O>
  submit: () => Promise<void>
  pending: boolean
  submitLabel: string
  destructive?: boolean
  children: React.ReactNode
}) {
  const tc = useTranslations("common")
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent showCloseButton={false} className="gap-5 p-5 sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg text-balance">{title}</DialogTitle>
          <DialogDescription className="text-pretty">{description}</DialogDescription>
        </DialogHeader>
        <Form form={form} onSubmit={submit} className="space-y-5">
          {children}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="lg" disabled={pending}>
                {tc("actions.cancel")}
              </Button>
            </DialogClose>
            <SubmitButton pending={pending} variant={destructive ? "destructive" : "default"}>
              {submitLabel}
            </SubmitButton>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Registrations tab: the row's menu ────────────────────────────────────────

export type RegistrationActionRow = {
  id: string
  participantName: string
  memberName: string
  status: "pending" | "confirmed" | "cancelled"
  /** In kuruş. */
  amount: number
}

/**
 * The "…" menu of a registration: "Record payment" (not paid yet) and
 * "Cancel registration" (active). Nothing for a cancelled one.
 */
export function RegistrationActions({
  registration: r,
  startsAt,
  defaultMethod,
}: {
  registration: RegistrationActionRow
  /** The workshop's start (ISO), for the refund under the terms. */
  startsAt: string
  /** The first way to pay that is switched on in the settings. */
  defaultMethod: PaymentMethod
}) {
  const t = useTranslations("workshops.registrations")
  const [open, setOpen] = useState<"pay" | "cancel" | null>(null)
  const canPay = r.status === "pending" && r.amount > 0
  if (r.status === "cancelled") return null

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        {canPay && (
          <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => setOpen("pay")}>
            <CircleCheckBigIcon />
            {t("pay.trigger")}
          </Button>
        )}
        {/* Non-modal, so the dialog can take focus cleanly. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("actionsFor", { name: r.participantName })}>
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-48">
            {canPay && (
              <>
                <DropdownMenuItem onSelect={() => setOpen("pay")}>
                  <CircleCheckBigIcon />
                  {t("pay.trigger")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem variant="destructive" onSelect={() => setOpen("cancel")}>
              <BanIcon />
              {t("cancel.trigger")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open === "pay" && (
        <RecordPaymentDialog registration={r} defaultMethod={defaultMethod} onClose={() => setOpen(null)} />
      )}
      {open === "cancel" && <CancelRegistrationDialog registration={r} startsAt={startsAt} onClose={() => setOpen(null)} />}
    </>
  )
}

/** "Record payment": how it was paid and when (today by default). */
function RecordPaymentDialog({
  registration: r,
  defaultMethod,
  onClose,
}: {
  registration: RegistrationActionRow
  defaultMethod: PaymentMethod
  onClose: () => void
}) {
  const t = useTranslations("workshops.registrations")
  const locale = useLocale()
  const amount = isolate(formatLira(r.amount, locale))
  const { form, submit, pending } = useActionForm({
    schema: recordPaymentSchema,
    action: recordPaymentAction,
    defaultValues: { id: r.id, method: defaultMethod, amount: r.amount, paidOn: todayIso() },
    successMessage: t("pay.done", { name: r.memberName }),
    onSuccess: onClose,
  })
  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("pay.title", { participant: r.participantName, amount })}
      description={t("pay.description", { name: r.memberName })}
      form={form}
      submit={submit}
      pending={pending}
      submitLabel={t("pay.submit", { amount })}
    >
      <ChoiceField<RecordPaymentValues, PaymentMethod>
        name="method"
        label={t("pay.method")}
        choices={(["cash", "transfer", "online"] as const).map((m) => ({
          value: m,
          title: t(`methods.${m}`),
          description: t(`methodHints.${m}`),
          icon: methodIcons[m],
        }))}
      />
      <DateField<RecordPaymentValues> name="paidOn" label={t("pay.date")} />
    </FormDialog>
  )
}

/** "Cancel registration": unpaid, nothing to refund; paid, the refund under the terms or in full. */
function CancelRegistrationDialog({
  registration: r,
  startsAt,
  onClose,
}: {
  registration: RegistrationActionRow
  startsAt: string
  onClose: () => void
}) {
  const t = useTranslations("workshops.registrations")
  const locale = useLocale()
  // What the terms give right now; the server works it out again when it cancels.
  const [preview] = useState(() => cancelPreview(r, new Date(startsAt)))
  const money = (kurus: number) => isolate(formatLira(kurus, locale))
  const { form, submit, pending } = useActionForm({
    schema: cancelRegistrationSchema,
    action: cancelRegistrationAction,
    defaultValues: { id: r.id, refund: "terms" },
    successMessage: t("cancel.done"),
    onSuccess: onClose,
  })
  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("cancel.title", { participant: r.participantName })}
      description={
        preview.paid > 0
          ? t("cancel.paid", { amount: money(preview.paid) })
          : r.amount > 0
            ? t("cancel.unpaid", { name: r.memberName })
            : t("cancel.free", { name: r.memberName })
      }
      form={form}
      submit={submit}
      pending={pending}
      submitLabel={t("cancel.submit")}
      destructive
    >
      {preview.paid > 0 && (
        <>
          <ChoiceField<CancelRegistrationValues, "terms" | "full">
            name="refund"
            label={t("cancel.refund")}
            choices={[
              {
                value: "terms",
                title: t("cancel.terms", { percent: formatPercent(preview.percent / 100, locale), amount: money(preview.refund) }),
                description: t(`cancel.band.${preview.percent}`),
              },
              { value: "full", title: t("cancel.full", { amount: money(preview.paid) }), description: t("cancel.fullHint") },
            ]}
          />
          <p className="text-muted-foreground text-sm text-pretty">{t("cancel.after", { name: r.memberName })}</p>
        </>
      )}
    </FormDialog>
  )
}

// ─── Refunds list ─────────────────────────────────────────────────────────────

/** "Mark as refunded": how the refund was paid back (cash or transfer) and when. */
export function MarkRefundedButton({
  id,
  amount,
  name,
  workshop,
}: {
  id: string
  /** In kuruş. */
  amount: number
  name: string
  workshop: string
}) {
  const t = useTranslations("money.refunds")
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="whitespace-nowrap">
        <Undo2Icon />
        {t("mark.trigger")}
      </Button>
      {open && <MarkRefundedDialog id={id} amount={amount} name={name} workshop={workshop} onClose={() => setOpen(false)} />}
    </>
  )
}

function MarkRefundedDialog({
  id,
  amount,
  name,
  workshop,
  onClose,
}: {
  id: string
  amount: number
  name: string
  workshop: string
  onClose: () => void
}) {
  const t = useTranslations("money.refunds")
  const locale = useLocale()
  const money = isolate(formatLira(amount, locale))
  const { form, submit, pending } = useActionForm({
    schema: markRefundedSchema,
    action: markRefundedAction,
    defaultValues: { id, method: "transfer", refundedOn: todayIso() },
    successMessage: t("mark.done", { name }),
    onSuccess: onClose,
  })
  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("mark.title", { amount: money })}
      description={t("mark.description", { name, title: workshop })}
      form={form}
      submit={submit}
      pending={pending}
      submitLabel={t("mark.submit")}
    >
      <ChoiceField<MarkRefundedValues, "cash" | "transfer">
        name="method"
        label={t("mark.method")}
        choices={(["transfer", "cash"] as const).map((m) => ({ value: m, title: t(`methods.${m}`), icon: methodIcons[m] }))}
      />
      <DateField<MarkRefundedValues> name="refundedOn" label={t("mark.date")} />
    </FormDialog>
  )
}
