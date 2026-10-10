"use client"

import {
  ArmchairIcon,
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
import { useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form"

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
import { payInstructor, recordAdvance, recordContribution, recordExpense, recordWithdrawal } from "@/features/money/actions"
import {
  advanceSchema,
  contributionSchema,
  expenseSchema,
  instructorPaymentSchema,
  withdrawalSchema,
  type AdvanceValues,
  type ContributionValues,
  type ExpenseFile,
  type ExpenseValues,
  type InstructorPaymentValues,
  type WithdrawalValues,
} from "@/features/money/schema"
import { formatLira } from "@/lib/money"
import { DateField, PartnerField, SourceField, todayIso, type PartnerOption } from "./fields"
import { ReceiptFiles } from "./receipt-files"

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

/**
 * Capital goes in from every partner at once, the same amount each (the
 * shares are equal and locked): the form asks for one partner's part and
 * shows who pays it and the total.
 */
export function ContributionDialog({ partners, trigger }: { partners: PartnerOption[]; trigger?: TriggerProps }) {
  const t = useTranslations("money.capital.contribution")
  return (
    <FormDialog icon={ArrowDownToLineIcon} label={t("trigger")} title={t("title")} description={t("description")} trigger={trigger}>
      {(close) => <ContributionForm partners={partners} onDone={close} />}
    </FormDialog>
  )
}

function ContributionForm({ partners, onDone }: { partners: PartnerOption[]; onDone: () => void }) {
  const t = useTranslations("money")
  const locale = useLocale()
  const { form, submit, pending } = useActionForm({
    schema: contributionSchema,
    action: recordContribution,
    defaultValues: { occurredOn: todayIso(), note: "" },
    successMessage: t("capital.contribution.done"),
    onSuccess: onDone,
  })
  const each = useWatch({ control: form.control, name: "amount" })
  const amount = typeof each === "number" && each > 0 ? each : 0
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("forms.save")}>
      <AmountField<ContributionValues> label={t("capital.contribution.each")} />
      <div className="bg-muted/50 space-y-1.5 rounded-lg p-3 text-sm">
        {partners.map((p) => (
          <p key={p.adminId} className="flex justify-between gap-4">
            <span>{p.name}</span>
            <span className="tabular-nums">{formatLira(amount, locale)}</span>
          </p>
        ))}
        <p className="flex justify-between gap-4 border-t pt-1.5 font-semibold">
          <span>{t("capital.contribution.total")}</span>
          <span className="tabular-nums">{formatLira(amount * partners.length, locale)}</span>
        </p>
      </div>
      <DateField<ContributionValues> name="occurredOn" label={t("forms.date")} />
      <TextField<ContributionValues> name="note" label={t("forms.note")} description={t("forms.noteHint")} maxLength={200} />
    </DialogForm>
  )
}

/** One partner takes money out (shown only while Settings → Money allows withdrawals). */
export function WithdrawalDialog({ partners, trigger }: { partners: PartnerOption[]; trigger?: TriggerProps }) {
  const t = useTranslations("money.capital.withdrawal")
  return (
    <FormDialog icon={ArrowUpFromLineIcon} label={t("trigger")} title={t("title")} description={t("description")} trigger={trigger}>
      {(close) => <WithdrawalForm partners={partners} onDone={close} />}
    </FormDialog>
  )
}

function WithdrawalForm({ partners, onDone }: { partners: PartnerOption[]; onDone: () => void }) {
  const t = useTranslations("money")
  const { form, submit, pending } = useActionForm({
    schema: withdrawalSchema,
    action: recordWithdrawal,
    defaultValues: { partnerId: partners.length === 1 ? partners[0].adminId : "", occurredOn: todayIso(), note: "" },
    successMessage: t("capital.withdrawal.done"),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("forms.save")}>
      <PartnerField<WithdrawalValues> name="partnerId" label={t("forms.partner")} partners={partners} />
      <AmountField<WithdrawalValues> label={t("forms.amount")} />
      <DateField<WithdrawalValues> name="occurredOn" label={t("forms.date")} />
      <TextField<WithdrawalValues> name="note" label={t("forms.note")} description={t("forms.noteHint")} maxLength={200} />
    </DialogForm>
  )
}

// ─── Expense ──────────────────────────────────────────────────────────────────

const categoryKeys = ["venue", "materials", "catering", "advertising", "transport", "printing"] as const

/**
 * Add an expense of a workshop (`courseId`) or, without it, a general expense
 * of the business; `furnishing`: furniture or equipment for the studio (a
 * general expense, with photos of what was bought). Receipts (photo or PDF)
 * can be kept with any of them.
 */
export function ExpenseDialog({
  courseId = null,
  advance,
  furnishing = false,
  trigger,
  blocked,
}: {
  courseId?: string | null
  /** Advance the instructor still holds (workshop expenses can be paid from it). */
  advance?: number
  furnishing?: boolean
  trigger?: TriggerProps
  blocked?: string | null
}) {
  const t = useTranslations("money.expense")
  const kind = furnishing ? "furnishing" : courseId === null ? "general" : "workshop"
  return (
    <FormDialog
      icon={furnishing ? ArmchairIcon : ReceiptTextIcon}
      label={t(`${kind}.trigger`)}
      title={t(`${kind}.title`)}
      description={t(`${kind}.description`)}
      trigger={trigger}
      blocked={blocked}
    >
      {(close) => <ExpenseForm courseId={furnishing ? null : courseId} advance={advance} furnishing={furnishing} onDone={close} />}
    </FormDialog>
  )
}

const furnishingKeys = ["furniture", "tools", "kitchen", "lighting", "decor", "electronics"] as const

function ExpenseForm({
  courseId,
  advance,
  furnishing,
  onDone,
}: {
  courseId: string | null
  advance?: number
  furnishing: boolean
  onDone: () => void
}) {
  const t = useTranslations("money")
  const listId = useId()
  const [uploading, setUploading] = useState(0)
  const { form, submit, pending } = useActionForm({
    schema: expenseSchema,
    action: recordExpense,
    defaultValues: { courseId, category: "", occurredOn: todayIso(), source: "wallet", furnishing, files: [] },
    successMessage: t(furnishing ? "expense.furnishing.done" : "expense.done"),
    onSuccess: onDone,
  })
  const files = useWatch({ control: form.control, name: "files" }) ?? []
  const addFile = (file: ExpenseFile) => form.setValue("files", [...(form.getValues("files") ?? []), file], { shouldDirty: true })
  const removeFile = (path: string) =>
    form.setValue("files", (form.getValues("files") ?? []).filter((f) => f.path !== path), { shouldDirty: true })
  const busy = (delta: number) => setUploading((n) => n + delta)
  return (
    <DialogForm form={form} submit={submit} pending={pending || uploading > 0} submitLabel={t("forms.save")}>
      <TextField<ExpenseValues>
        name="category"
        label={furnishing ? t("forms.item") : t("forms.category")}
        description={furnishing ? t("forms.itemHint") : t("forms.categoryHint")}
        required
        maxLength={100}
        list={listId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {furnishing
          ? furnishingKeys.map((k) => <option key={k} value={t(`forms.furnishingKinds.${k}`)} />)
          : categoryKeys.map((k) => <option key={k} value={t(`forms.categories.${k}`)} />)}
      </datalist>
      <AmountField<ExpenseValues> label={t("forms.amount")} />
      <DateField<ExpenseValues> name="occurredOn" label={t("forms.date")} />
      {courseId && advance ? (
        <SourceField<ExpenseValues> name="source" label={t("forms.paidFrom")} advance={advance} description={t("forms.advanceHint")} />
      ) : (
        <FromWallet text={t("forms.fromWallet")} />
      )}
      {furnishing && (
        <ReceiptFiles
          role="photo"
          label={t("receipts.field.photos")}
          hint={t("receipts.field.photosHint")}
          value={files}
          onAdd={addFile}
          onRemove={removeFile}
          onBusy={busy}
        />
      )}
      <ReceiptFiles
        role="receipt"
        label={t("receipts.field.receipts")}
        hint={t("receipts.field.receiptsHint")}
        value={files}
        onAdd={addFile}
        onRemove={removeFile}
        onBusy={busy}
      />
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
