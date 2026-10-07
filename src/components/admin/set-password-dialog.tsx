"use client"

import { CheckIcon, CopyIcon, KeyRoundIcon, MailCheckIcon, MailWarningIcon, SparklesIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useId, useState, useTransition } from "react"
import { toast } from "sonner"

import { Form, SubmitButton } from "@/components/admin/form/form"
import { PasswordField } from "@/components/admin/form/password-field"
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
import type { SetPasswordResult } from "@/features/accounts/admin-access"
import { adminPasswordTypedSchema, type AdminPasswordTypedValues } from "@/features/accounts/schema"
import { setInstructorPassword } from "@/features/instructors/actions"
import { setStudentPassword } from "@/features/students/actions"
import { ACCOUNT_PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas"
import { isolate } from "@/lib/format"
import { cn } from "@/lib/utils"

type Generated = { password: string; emailed: boolean }

/**
 * "Change password" on an instructor's or student's admin page: type a new
 * password, or have a strong one generated on the server. A typed one closes
 * the dialog with a toast; a generated one is shown once, with a Copy button
 * (opening the dialog again never shows it again). The person's name is
 * isolated in every sentence, so a Latin name reads correctly in Persian.
 */
export function SetPasswordDialog({
  kind,
  id,
  name,
  disabled,
}: {
  kind: "instructor" | "member"
  id: string
  name: string
  disabled?: boolean
}) {
  const t = useTranslations("admin.access.password")
  const [open, setOpen] = useState(false)
  const [generated, setGenerated] = useState<Generated | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setGenerated(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="shrink-0 px-4" disabled={disabled}>
          <KeyRoundIcon />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        // The password is shown only now: a stray tap beside the dialog must not lose it (Escape and Close still work).
        onInteractOutside={(event) => {
          if (generated) event.preventDefault()
        }}
        className="gap-5 p-5 sm:max-w-md"
      >
        {generated ? (
          <GeneratedPassword name={name} result={generated} />
        ) : (
          <>
            <DialogHeader className="text-start">
              <DialogTitle className="text-lg">{t("dialogTitle", { name: isolate(name) })}</DialogTitle>
              <DialogDescription className="text-pretty">{t("dialogDescription")}</DialogDescription>
            </DialogHeader>
            <SetPasswordForm
              kind={kind}
              id={id}
              name={name}
              onTyped={() => setOpen(false)}
              onGenerated={setGenerated}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SetPasswordForm({
  kind,
  id,
  name,
  onTyped,
  onGenerated,
}: {
  kind: "instructor" | "member"
  id: string
  name: string
  onTyped: () => void
  onGenerated: (result: Generated) => void
}) {
  const t = useTranslations("admin.access.password")
  const tc = useTranslations("common")
  const action = kind === "instructor" ? setInstructorPassword : setStudentPassword
  const [generating, startGenerating] = useTransition()
  const { form, submit, pending } = useActionForm({
    schema: adminPasswordTypedSchema,
    action,
    defaultValues: { id, mode: "type", password: "" },
    successMessage: false,
    onSuccess: (result: SetPasswordResult) => {
      onTyped()
      if (result.emailed) toast.success(t("saved", { name: isolate(name) }))
      else toast.warning(t("savedNotEmailed", { name: isolate(name) }))
    },
  })
  const busy = pending || generating

  function generate() {
    startGenerating(async () => {
      try {
        const result = await action({ id, mode: "generate" })
        if (!result) return // the action redirected (e.g. the session ended)
        if (!result.ok) toast.error(result.error)
        else if (result.data.password) onGenerated({ password: result.data.password, emailed: result.data.emailed })
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <div className="space-y-5">
      <Form form={form} onSubmit={submit} className="space-y-4">
        <PasswordField<AdminPasswordTypedValues>
          name="password"
          label={t("field")}
          description={t("hint", { min: ACCOUNT_PASSWORD_MIN_LENGTH })}
          // Never offer the admin's own saved password here.
          autoComplete="new-password"
          autoFocus
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="lg" disabled={busy}>
              {tc("actions.cancel")}
            </Button>
          </DialogClose>
          <SubmitButton pending={pending} disabled={generating}>
            {t("save")}
          </SubmitButton>
        </div>
      </Form>

      <div className="text-muted-foreground flex items-center gap-3 text-xs" aria-hidden>
        <span className="bg-border h-px flex-1" />
        {t("or")}
        <span className="bg-border h-px flex-1" />
      </div>

      <Button type="button" variant="outline" size="lg" className="w-full" onClick={generate} disabled={busy}>
        {generating ? <Spinner aria-hidden /> : <SparklesIcon aria-hidden />}
        {t("generate")}
      </Button>
    </div>
  )
}

/** The generated password, this one time: Copy, how to share it, and whether the person was emailed. */
function GeneratedPassword({ name, result }: { name: string; result: Generated }) {
  const t = useTranslations("admin.access.password.result")
  const tc = useTranslations("common")
  const Icon = result.emailed ? MailCheckIcon : MailWarningIcon

  return (
    <div className="space-y-5">
      <DialogHeader className="text-start">
        <span
          aria-hidden
          className={cn(
            "mb-1 flex size-11 items-center justify-center rounded-full [&_svg]:size-5",
            result.emailed ? "bg-success/12 text-success" : "bg-warning/12 text-warning",
          )}
        >
          <Icon />
        </span>
        <DialogTitle className="text-lg">{t("title", { name: isolate(name) })}</DialogTitle>
        <DialogDescription className="text-pretty">
          {result.emailed ? t("emailed", { name: isolate(name) }) : t("notEmailed", { name: isolate(name) })}
        </DialogDescription>
      </DialogHeader>

      <PasswordToCopy password={result.password} />

      <ul className="text-muted-foreground list-disc space-y-1.5 ps-5 text-sm text-pretty">
        <li>{t("once")}</li>
        <li>{t("share", { name: isolate(name) })}</li>
      </ul>

      <div className="flex justify-end">
        <DialogClose asChild>
          <Button type="button" size="lg" className="w-full px-6 sm:w-auto">
            {tc("actions.close")}
          </Button>
        </DialogClose>
      </div>
    </div>
  )
}

/** The password in a read-only box (left-to-right in every language) with a Copy button. */
function PasswordToCopy({ password }: { password: string }) {
  const t = useTranslations("admin.access.password.result")
  const id = useId()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      toast.success(t("copied"))
    } catch {
      toast.error(t("copyFailed"))
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {t("label")}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={password}
          readOnly
          dir="ltr"
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          className="bg-muted/50 h-10 min-w-0 flex-1 font-mono text-base tracking-wide"
        />
        <Button type="button" onClick={copy} className="h-10 shrink-0 px-3.5">
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copied ? t("copiedShort") : t("copy")}
        </Button>
      </div>
    </div>
  )
}
