"use client"

import { PencilIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useId, useState } from "react"
import { useWatch } from "react-hook-form"

import { TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { editAdvance, editContribution, editExpense, editInstructorPayment } from "@/features/money/actions"
import type { EditTarget } from "@/features/money/queries"
import {
  editAdvanceSchema,
  editContributionSchema,
  editExpenseSchema,
  editInstructorPaymentSchema,
  type AdvanceValues,
  type ContributionValues,
  type ExpenseFile,
  type ExpenseValues,
  type InstructorPaymentValues,
} from "@/features/money/schema"
import { AmountField, categoryKeys, DialogForm, FromWallet, furnishingKeys } from "./dialogs"
import { DateField } from "./fields"
import { ReceiptFiles } from "./receipt-files"

/**
 * "Edit" on an entry (an expense, furnishing, a contribution, an advance or
 * an instructor's payment): the form it was recorded with, filled in. Saving
 * reverses the original and records the corrected entry in its place
 * (`startEdit`); the lists then show only the corrected one.
 */
export function EditEntry({ target, size = "sm" }: { target: EditTarget; size?: "sm" | "xs" }) {
  const t = useTranslations("money.edit")
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size={size} className="text-muted-foreground hover:text-foreground print:hidden">
          <PencilIcon />
          {t("action")}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-5 p-5 sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg">{t("title")}</DialogTitle>
          <DialogDescription className="text-pretty">{t("description")}</DialogDescription>
        </DialogHeader>
        {target.kind === "expense" && <ExpenseEdit target={target} onDone={close} />}
        {target.kind === "capital_contribution" && <ContributionEdit target={target} onDone={close} />}
        {target.kind === "instructor_advance" && <AdvanceEdit target={target} onDone={close} />}
        {target.kind === "instructor_payment" && <PaymentEdit target={target} onDone={close} />}
      </DialogContent>
    </Dialog>
  )
}

type Of<K extends EditTarget["kind"]> = Extract<EditTarget, { kind: K }>

function ExpenseEdit({ target, onDone }: { target: Of<"expense">; onDone: () => void }) {
  const t = useTranslations("money")
  const listId = useId()
  const [uploading, setUploading] = useState(0)
  const { furnishing } = target.values
  const { form, submit, pending } = useActionForm({
    schema: editExpenseSchema,
    action: editExpense,
    defaultValues: { id: target.id, ...target.values },
    successMessage: t("edit.done"),
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
      <FromWallet text={target.values.source === "advance" ? t("finances.fromAdvance") : t("forms.fromWallet")} />
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

function ContributionEdit({ target, onDone }: { target: Of<"capital_contribution">; onDone: () => void }) {
  const t = useTranslations("money")
  const { form, submit, pending } = useActionForm({
    schema: editContributionSchema,
    action: editContribution,
    defaultValues: { id: target.id, ...target.values },
    successMessage: t("edit.done"),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("forms.save")}>
      <AmountField<ContributionValues> label={t("capital.contribution.each")} />
      <DateField<ContributionValues> name="occurredOn" label={t("forms.date")} />
      <TextField<ContributionValues> name="note" label={t("forms.note")} maxLength={200} />
    </DialogForm>
  )
}

function AdvanceEdit({ target, onDone }: { target: Of<"instructor_advance">; onDone: () => void }) {
  const t = useTranslations("money")
  const { form, submit, pending } = useActionForm({
    schema: editAdvanceSchema,
    action: editAdvance,
    defaultValues: { id: target.id, ...target.values },
    successMessage: t("edit.done"),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("forms.save")}>
      <AmountField<AdvanceValues> label={t("forms.amount")} />
      <DateField<AdvanceValues> name="occurredOn" label={t("forms.date")} />
      <FromWallet text={target.values.direction === "paid" ? t("forms.fromWallet") : t("forms.toWallet")} />
      <TextField<AdvanceValues> name="note" label={t("forms.note")} maxLength={200} />
    </DialogForm>
  )
}

function PaymentEdit({ target, onDone }: { target: Of<"instructor_payment">; onDone: () => void }) {
  const t = useTranslations("money")
  const { form, submit, pending } = useActionForm({
    schema: editInstructorPaymentSchema,
    action: editInstructorPayment,
    defaultValues: { id: target.id, ...target.values },
    successMessage: t("edit.done"),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("forms.save")}>
      <AmountField<InstructorPaymentValues> label={t("forms.amount")} />
      <DateField<InstructorPaymentValues> name="occurredOn" label={t("forms.date")} />
      <FromWallet text={t("forms.fromWallet")} />
      <TextField<InstructorPaymentValues> name="note" label={t("forms.note")} maxLength={200} />
    </DialogForm>
  )
}
