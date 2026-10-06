"use client"

import { useTranslations } from "next-intl"

import { Form, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { changeAdminPasswordAction } from "@/lib/auth/actions"
import { changePasswordSchema, PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas"

/** "Change password" from the user menu. The form mounts fresh each time the dialog opens. */
export function ChangePasswordDialog({
  email,
  open,
  onOpenChange,
}: {
  email: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("auth.password")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <ChangePasswordForm email={email} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ChangePasswordForm({ email, onDone }: { email: string; onDone: () => void }) {
  const t = useTranslations("auth.password")
  const tc = useTranslations("common")
  const { form, submit, pending } = useActionForm({
    schema: changePasswordSchema,
    action: changeAdminPasswordAction,
    defaultValues: { current: "", next: "", confirm: "" },
    successMessage: t("done"),
    onSuccess: onDone,
  })
  const password = { type: "password", dir: "ltr", maxLength: 256 } as const

  return (
    <Form form={form} onSubmit={submit} className="space-y-4">
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <TextField name="current" label={t("current")} autoComplete="current-password" autoFocus {...password} />
      <TextField
        name="next"
        label={t("next")}
        description={t("nextHint", { min: PASSWORD_MIN_LENGTH })}
        autoComplete="new-password"
        {...password}
      />
      <TextField name="confirm" label={t("confirm")} autoComplete="new-password" {...password} />
      <DialogFooter className="mt-6">
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {tc("actions.cancel")}
          </Button>
        </DialogClose>
        <SubmitButton pending={pending} size="default">
          {t("submit")}
        </SubmitButton>
      </DialogFooter>
    </Form>
  )
}
