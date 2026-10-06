"use client"

import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BanknoteIcon,
  HandCoinsIcon,
  ReceiptTextIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useId, useState } from "react"
import type { FieldValues, Path, UseFormReturn } from "react-hook-form"

import { Form, FormField, SubmitButton, TextField } from "@/components/admin/form/form"
import { MoneyInput } from "@/components/admin/form/money-input"
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
import { payInstructor, recordAdvance, recordCapital, recordExpense } from "@/features/money/actions"
import {
  advanceSchema,
  capitalSchema,
  expenseSchema,
  instructorPaymentSchema,
  type AdvanceValues,
  type CapitalValues,
  type ExpenseValues,
  type InstructorPaymentValues,
} from "@/features/money/schema"
import { formatLira } from "@/lib/money"
import { DateField, PartnerField, SourceField, todayIso, type PartnerOption } from "./fields"

type TriggerProps = { variant?: "default" | "outline" | "ghost"; size?: "lg" | "sm"; className?: string }

/** A button that opens a small form in a dialog. The form mounts fresh each time it opens. */
function FormDialog({
  icon: Icon,
  label,
  title,
  description,
  trigger,
  children,
}: {
  icon: LucideIcon
  label: string
  title: string
  description: React.ReactNode
  trigger?: TriggerProps
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={trigger?.variant ?? "outline"} size={trigger?.size ?? "lg"} className={trigger?.className ?? "px-4"}>
          <Icon />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-5 p-5 sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription className="text-pretty">{description}</DialogDescription>
        </DialogHeader>
        {children(() => setOpen(false))}
      </DialogContent>
    </Dialog>
  )
}

/** The form inside a dialog: fields, then Cancel / Save. */
function DialogForm<T extends FieldValues, C, O>({
  form,
  submit,
  pending,
  submitLabel,
  children,
}: {
  form: UseFormReturn<T, C, O>
  submit: () => Promise<void>
  pending: boolean
  submitLabel: string
  children: React.ReactNode
}) {
  const tc = useTranslations("common")
  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      {children}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="lg" disabled={pending}>
            {tc("actions.cancel")}
          </Button>
        </DialogClose>
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
      </div>
    </Form>
  )
}

/** The "amount" field of a money form (kuruş, typed as lira). */
function AmountField<T extends FieldValues>({ label, description }: { label: string; description?: string }) {
  return (
    <FormField<T> name={"amount" as Path<T>} label={label} description={description} required>
      {(field) => <MoneyInput {...field} ref={field.ref} className="h-10 text-base" />}
    </FormField>
  )
}

// ─── Capital: contribution / withdrawal ───────────────────────────────────────

export function CapitalDialog({
  direction,
  partners,
  defaultPartnerId,
  trigger,
}: {
  direction: "contribution" | "withdrawal"
  partners: PartnerOption[]
  defaultPartnerId?: string
  trigger?: TriggerProps
}) {
  const t = useTranslations(`money.capital.${direction}`)
  return (
    <FormDialog
      icon={direction === "contribution" ? ArrowDownToLineIcon : ArrowUpFromLineIcon}
      label={t("trigger")}
      title={t("title")}
      description={t("description")}
      trigger={trigger}
    >
      {(close) => <CapitalForm direction={direction} partners={partners} defaultPartnerId={defaultPartnerId} onDone={close} />}
    </FormDialog>
  )
}

function CapitalForm({
  direction,
  partners,
  defaultPartnerId,
  onDone,
}: {
  direction: "contribution" | "withdrawal"
  partners: PartnerOption[]
  defaultPartnerId?: string
  onDone: () => void
}) {
  const t = useTranslations("money")
  const { form, submit, pending } = useActionForm({
    schema: capitalSchema,
    action: recordCapital,
    defaultValues: {
      direction,
      partnerId: defaultPartnerId ?? (partners.length === 1 ? partners[0].adminId : ""),
      occurredOn: todayIso(),
      note: "",
    },
    successMessage: t(`capital.${direction}.done`),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("forms.save")}>
      <PartnerField<CapitalValues> name="partnerId" label={t("forms.partner")} partners={partners} />
      <AmountField<CapitalValues> label={t("forms.amount")} />
      <DateField<CapitalValues> name="occurredOn" label={t("forms.date")} />
      <TextField<CapitalValues> name="note" label={t("forms.note")} description={t("forms.noteHint")} maxLength={200} />
    </DialogForm>
  )
}

// ─── Expense ──────────────────────────────────────────────────────────────────

const categoryKeys = ["venue", "materials", "catering", "advertising", "transport", "printing"] as const

/** Add an expense of a workshop (`courseId`) or, without it, a general expense of the business. */
export function ExpenseDialog({
  courseId = null,
  partners,
  advance,
  trigger,
}: {
  courseId?: string | null
  partners: PartnerOption[]
  /** Advance the instructor still holds (workshop expenses can be paid from it). */
  advance?: number
  trigger?: TriggerProps
}) {
  const t = useTranslations("money.expense")
  const general = courseId === null
  return (
    <FormDialog
      icon={ReceiptTextIcon}
      label={general ? t("generalTrigger") : t("trigger")}
      title={general ? t("generalTitle") : t("title")}
      description={general ? t("generalDescription") : t("description")}
      trigger={trigger}
    >
      {(close) => <ExpenseForm courseId={courseId} partners={partners} advance={advance} onDone={close} />}
    </FormDialog>
  )
}

function ExpenseForm({
  courseId,
  partners,
  advance,
  onDone,
}: {
  courseId: string | null
  partners: PartnerOption[]
  advance?: number
  onDone: () => void
}) {
  const t = useTranslations("money")
  const listId = useId()
  const { form, submit, pending } = useActionForm({
    schema: expenseSchema,
    action: recordExpense,
    defaultValues: { courseId, category: "", occurredOn: todayIso(), source: "wallet" },
    successMessage: t("expense.done"),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("forms.save")}>
      <TextField<ExpenseValues>
        name="category"
        label={t("forms.category")}
        description={t("forms.categoryHint")}
        required
        maxLength={100}
        list={listId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {categoryKeys.map((k) => (
          <option key={k} value={t(`forms.categories.${k}`)} />
        ))}
      </datalist>
      <AmountField<ExpenseValues> label={t("forms.amount")} />
      <DateField<ExpenseValues> name="occurredOn" label={t("forms.date")} />
      <SourceField<ExpenseValues>
        name="source"
        label={t("forms.paidFrom")}
        partners={partners}
        advance={courseId ? advance : undefined}
        description={courseId && advance ? t("forms.advanceHint") : undefined}
      />
    </DialogForm>
  )
}

// ─── Instructor advance ───────────────────────────────────────────────────────

/** Record an advance paid to the instructor, or money they returned. */
export function AdvanceDialog({
  courseId,
  direction,
  partners,
  held,
  suggested,
  trigger,
}: {
  courseId: string
  direction: "paid" | "returned"
  partners: PartnerOption[]
  /** Advance the instructor holds now. */
  held: number
  /** Pre-filled amount (e.g. the rest of the advance agreed in the contract). */
  suggested?: number
  trigger?: TriggerProps
}) {
  const t = useTranslations("money.advance")
  const locale = useLocale()
  return (
    <FormDialog
      icon={direction === "paid" ? HandCoinsIcon : Undo2Icon}
      label={t(`${direction}.trigger`)}
      title={t(`${direction}.title`)}
      description={
        direction === "returned" ? t("returned.description", { amount: formatLira(held, locale) }) : t("paid.description")
      }
      trigger={trigger}
    >
      {(close) => (
        <AdvanceForm courseId={courseId} direction={direction} partners={partners} suggested={suggested} onDone={close} />
      )}
    </FormDialog>
  )
}

function AdvanceForm({
  courseId,
  direction,
  partners,
  suggested,
  onDone,
}: {
  courseId: string
  direction: "paid" | "returned"
  partners: PartnerOption[]
  suggested?: number
  onDone: () => void
}) {
  const t = useTranslations("money")
  const { form, submit, pending } = useActionForm({
    schema: advanceSchema,
    action: recordAdvance,
    defaultValues: {
      courseId,
      direction,
      amount: suggested && suggested > 0 ? suggested : undefined,
      occurredOn: todayIso(),
      source: "wallet",
      note: "",
    },
    successMessage: t(`advance.${direction}.done`),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("forms.save")}>
      <AmountField<AdvanceValues> label={t("forms.amount")} />
      <DateField<AdvanceValues> name="occurredOn" label={t("forms.date")} />
      <SourceField<AdvanceValues>
        name="source"
        label={direction === "paid" ? t("forms.paidFrom") : t("forms.paidBackTo")}
        partners={partners}
      />
      <TextField<AdvanceValues> name="note" label={t("forms.note")} description={t("forms.noteHint")} maxLength={200} />
    </DialogForm>
  )
}

// ─── Instructor payment ───────────────────────────────────────────────────────

/** Pay the instructor what a closed workshop still owes them. */
export function PayInstructorDialog({
  courseId,
  partners,
  owed,
  instructor,
  trigger,
}: {
  courseId: string
  partners: PartnerOption[]
  owed: number
  instructor: string
  trigger?: TriggerProps
}) {
  const t = useTranslations("money.pay")
  const locale = useLocale()
  return (
    <FormDialog
      icon={BanknoteIcon}
      label={t("trigger")}
      title={t("title")}
      description={t("description", { name: instructor, amount: formatLira(owed, locale) })}
      trigger={trigger ?? { variant: "default" }}
    >
      {(close) => <PayForm courseId={courseId} partners={partners} owed={owed} onDone={close} />}
    </FormDialog>
  )
}

function PayForm({
  courseId,
  partners,
  owed,
  onDone,
}: {
  courseId: string
  partners: PartnerOption[]
  owed: number
  onDone: () => void
}) {
  const t = useTranslations("money")
  const { form, submit, pending } = useActionForm({
    schema: instructorPaymentSchema,
    action: payInstructor,
    defaultValues: { courseId, amount: owed, occurredOn: todayIso(), source: "wallet", note: "" },
    successMessage: t("pay.done"),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("pay.submit")}>
      <AmountField<InstructorPaymentValues> label={t("forms.amount")} />
      <DateField<InstructorPaymentValues> name="occurredOn" label={t("forms.date")} />
      <SourceField<InstructorPaymentValues> name="source" label={t("forms.paidFrom")} partners={partners} />
      <TextField<InstructorPaymentValues> name="note" label={t("forms.note")} description={t("forms.noteHint")} maxLength={200} />
    </DialogForm>
  )
}
