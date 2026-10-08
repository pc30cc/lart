"use client"

import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BanknoteIcon,
  HandCoinsIcon,
  LockIcon,
  ReceiptTextIcon,
  Undo2Icon,
  WalletIcon,
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
  blocked,
  children,
}: {
  icon: LucideIcon
  label: string
  title: string
  description: React.ReactNode
  trigger?: TriggerProps
  /** Why this admin cannot record it (Settings → Money): the dialog says so instead of showing the form. */
  blocked?: string | null
  children: (close: () => void) => React.ReactNode
}) {
  const tc = useTranslations("common")
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
        {blocked ? (
          <>
            <p role="status" className="bg-muted text-foreground flex gap-2.5 rounded-lg p-3 text-sm text-pretty">
              <LockIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              {blocked}
            </p>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" size="lg">
                  {tc("actions.close")}
                </Button>
              </DialogClose>
            </div>
          </>
        ) : (
          children(() => setOpen(false))
        )}
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

/** Where the money comes from or goes: always the shared wallet (no partner pays personally). */
function FromWallet({ text }: { text: string }) {
  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <WalletIcon className="size-4 shrink-0" aria-hidden />
      {text}
    </p>
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
  advance,
  trigger,
  blocked,
}: {
  courseId?: string | null
  /** Advance the instructor still holds (workshop expenses can be paid from it). */
  advance?: number
  trigger?: TriggerProps
  blocked?: string | null
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
      blocked={blocked}
    >
      {(close) => <ExpenseForm courseId={courseId} advance={advance} onDone={close} />}
    </FormDialog>
  )
}

function ExpenseForm({
  courseId,
  advance,
  onDone,
}: {
  courseId: string | null
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
      {courseId && advance ? (
        <SourceField<ExpenseValues> name="source" label={t("forms.paidFrom")} advance={advance} description={t("forms.advanceHint")} />
      ) : (
        <FromWallet text={t("forms.fromWallet")} />
      )}
    </DialogForm>
  )
}

// ─── Instructor advance ───────────────────────────────────────────────────────

/** Record an advance paid to the instructor, or money they returned. */
export function AdvanceDialog({
  courseId,
  direction,
  held,
  suggested,
  trigger,
  blocked,
}: {
  courseId: string
  direction: "paid" | "returned"
  /** Advance the instructor holds now. */
  held: number
  /** Pre-filled amount (e.g. the rest of the advance agreed in the contract). */
  suggested?: number
  trigger?: TriggerProps
  blocked?: string | null
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
      blocked={blocked}
    >
      {(close) => <AdvanceForm courseId={courseId} direction={direction} suggested={suggested} onDone={close} />}
    </FormDialog>
  )
}

function AdvanceForm({
  courseId,
  direction,
  suggested,
  onDone,
}: {
  courseId: string
  direction: "paid" | "returned"
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
      note: "",
    },
    successMessage: t(`advance.${direction}.done`),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("forms.save")}>
      <AmountField<AdvanceValues> label={t("forms.amount")} />
      <DateField<AdvanceValues> name="occurredOn" label={t("forms.date")} />
      <FromWallet text={direction === "paid" ? t("forms.fromWallet") : t("forms.toWallet")} />
      <TextField<AdvanceValues> name="note" label={t("forms.note")} description={t("forms.noteHint")} maxLength={200} />
    </DialogForm>
  )
}

// ─── Instructor payment ───────────────────────────────────────────────────────

/** Pay the instructor what a closed workshop still owes them. */
export function PayInstructorDialog({
  courseId,
  owed,
  instructor,
  trigger,
  blocked,
}: {
  courseId: string
  owed: number
  instructor: string
  trigger?: TriggerProps
  blocked?: string | null
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
      blocked={blocked}
    >
      {(close) => <PayForm courseId={courseId} owed={owed} onDone={close} />}
    </FormDialog>
  )
}

function PayForm({
  courseId,
  owed,
  onDone,
}: {
  courseId: string
  owed: number
  onDone: () => void
}) {
  const t = useTranslations("money")
  const { form, submit, pending } = useActionForm({
    schema: instructorPaymentSchema,
    action: payInstructor,
    defaultValues: { courseId, amount: owed, occurredOn: todayIso(), note: "" },
    successMessage: t("pay.done"),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("pay.submit")}>
      <AmountField<InstructorPaymentValues> label={t("forms.amount")} />
      <DateField<InstructorPaymentValues> name="occurredOn" label={t("forms.date")} />
      <FromWallet text={t("forms.fromWallet")} />
      <TextField<InstructorPaymentValues> name="note" label={t("forms.note")} description={t("forms.noteHint")} maxLength={200} />
    </DialogForm>
  )
}
