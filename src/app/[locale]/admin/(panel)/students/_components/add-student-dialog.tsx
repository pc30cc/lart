"use client"

import { MailCheckIcon, MailWarningIcon, UserPlusIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"

import { Form, FormField, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { PasswordToCopy } from "@/components/admin/set-password-dialog"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AddedMember } from "@/features/accounts/admin-access"
import { addMemberSchema, type AddMemberValues } from "@/features/accounts/schema"
import { addStudent } from "@/features/students/actions"
import { Link } from "@/i18n/navigation"
import { locales, type AppLocale } from "@/i18n/routing"
import { isolate } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Students → "Add participant": name, email, optional phone and the language
 * of their emails. The server makes the account with a short password and
 * emails it to them; the password is then shown here once, to copy or read out.
 */
export function AddStudentDialog() {
  const t = useTranslations("students.add")
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState<(AddedMember & { name: string }) | null>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setAdded(null)
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" className="px-4">
          <UserPlusIcon />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        // The password is shown only now: a stray tap beside the dialog must not lose it.
        onInteractOutside={(event) => {
          if (added) event.preventDefault()
        }}
        className="gap-5 p-5 sm:max-w-md"
      >
        {added ? (
          <Added added={added} />
        ) : (
          <>
            <DialogHeader className="text-start">
              <DialogTitle className="text-lg">{t("title")}</DialogTitle>
              <DialogDescription className="text-pretty">{t("description")}</DialogDescription>
            </DialogHeader>
            <AddForm onAdded={setAdded} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddForm({ onAdded }: { onAdded: (added: AddedMember & { name: string }) => void }) {
  const t = useTranslations("students.add")
  const tc = useTranslations("common")
  const locale = useLocale() as AppLocale
  const { form, submit, pending } = useActionForm({
    schema: addMemberSchema,
    action: addStudent,
    defaultValues: { name: "", email: "", phone: "", locale },
    successMessage: false,
    onSuccess: (result: AddedMember) => onAdded({ ...result, name: form.getValues("name") }),
  })
  return (
    <Form form={form} onSubmit={submit} className="space-y-4">
      <TextField<AddMemberValues> name="name" label={t("name")} required maxLength={80} autoComplete="off" autoFocus />
      <TextField<AddMemberValues> name="email" label={t("email")} required type="email" dir="ltr" maxLength={254} autoComplete="off" />
      <TextField<AddMemberValues> name="phone" label={t("phone")} type="tel" dir="ltr" maxLength={40} autoComplete="off" />
      <FormField<AddMemberValues> name="locale" label={t("locale")} description={t("localeHint")}>
        {(field) => (
          <Select value={field.value as string} onValueChange={(v) => field.onChange(v)}>
            <SelectTrigger id={field.id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {locales.map((l) => (
                <SelectItem key={l} value={l}>
                  {t(`languages.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="lg" disabled={pending}>
            {tc("actions.cancel")}
          </Button>
        </DialogClose>
        <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
      </div>
    </Form>
  )
}

function Added({ added }: { added: AddedMember & { name: string } }) {
  const t = useTranslations("students.add.result")
  const tc = useTranslations("common")
  const Icon = added.emailed ? MailCheckIcon : MailWarningIcon
  return (
    <div className="space-y-5">
      <DialogHeader className="text-start">
        <span
          aria-hidden
          className={cn(
            "mb-1 flex size-11 items-center justify-center rounded-full [&_svg]:size-5",
            added.emailed ? "bg-success/12 text-success" : "bg-warning/12 text-warning",
          )}
        >
          <Icon />
        </span>
        <DialogTitle className="text-lg">{t("title", { name: isolate(added.name) })}</DialogTitle>
        <DialogDescription className="text-pretty">
          {added.emailed ? t("emailed", { name: isolate(added.name) }) : t("notEmailed", { name: isolate(added.name) })}
        </DialogDescription>
      </DialogHeader>
      <PasswordToCopy password={added.password} />
      <p className="text-muted-foreground text-sm text-pretty">{t("once")}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="lg">
            {tc("actions.close")}
          </Button>
        </DialogClose>
        <Button asChild size="lg">
          <Link href={`/admin/students/${added.id}`}>{t("open")}</Link>
        </Button>
      </div>
    </div>
  )
}
