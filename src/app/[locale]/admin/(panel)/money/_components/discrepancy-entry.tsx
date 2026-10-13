"use client"

import { FileWarningIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"

import { TextareaField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { markDiscrepancy } from "@/features/money/actions"
import { discrepancySchema, type DiscrepancyValues } from "@/features/money/schema"
import { DialogForm } from "./dialogs"

/**
 * "Discrepancy": an entry that concerns neither a participant nor an
 * instructor is brought to zero with a reason, which stays under it with who
 * recorded it (`markDiscrepancy`). Entries are never deleted.
 */
export function DiscrepancyEntry({ id, what, iconOnly = false }: { id: string; what: string; iconOnly?: boolean }) {
  const t = useTranslations("money.discrepancy")
  const [open, setOpen] = useState(false)
  return (
    // Clicks inside the dialog must not open or close the table row around it (portals bubble through React).
    <span onClick={(e) => e.stopPropagation()} className="contents">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          {iconOnly ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("action")}
              title={t("action")}
              className="text-muted-foreground hover:text-warning hover:bg-warning/10 print:hidden"
            >
              <FileWarningIcon />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-warning print:hidden">
              <FileWarningIcon />
              {t("action")}
            </Button>
          )}
        </DialogTrigger>
        <DialogContent showCloseButton={false} className="gap-5 p-5 sm:max-w-md">
          <DialogHeader className="text-start">
            <DialogTitle className="text-lg">{t("title")}</DialogTitle>
            <DialogDescription className="text-pretty">{t("description", { what })}</DialogDescription>
          </DialogHeader>
          {open && <DiscrepancyForm id={id} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </span>
  )
}

function DiscrepancyForm({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useTranslations("money.discrepancy")
  const { form, submit, pending } = useActionForm({
    schema: discrepancySchema,
    action: markDiscrepancy,
    defaultValues: { id, reason: "" },
    successMessage: t("done"),
    onSuccess: onDone,
  })
  return (
    <DialogForm form={form} submit={submit} pending={pending} submitLabel={t("confirm")}>
      <TextareaField<DiscrepancyValues>
        name="reason"
        label={t("reason")}
        description={t("reasonHint")}
        required
        rows={3}
        maxLength={500}
        autoFocus
      />
    </DialogForm>
  )
}
