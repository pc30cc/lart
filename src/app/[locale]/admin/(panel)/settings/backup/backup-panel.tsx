"use client"

import { DatabaseBackupIcon, EyeIcon, FileSpreadsheetIcon, FolderArchiveIcon, EyeOffIcon, KeyRoundIcon, ShieldAlertIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Form, FormActions, FormField, FormSection, SubmitButton } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { createManualBackup, saveBackupSettings } from "@/features/backup/actions"
import { backupSettingsSchema, type BackupSettingsValues } from "@/features/backup/schema"
import { cn } from "@/lib/utils"

/**
 * The backup password (typed twice; once set it is never shown again, only
 * replaced) and the switch for the automatic daily backups.
 */
export function BackupSettingsForm({ hasPassword, auto }: { hasPassword: boolean; auto: boolean }) {
  const t = useTranslations("settings.backup")
  const tc = useTranslations("common")
  const [replacing, setReplacing] = useState(!hasPassword)
  const [shown, setShown] = useState(false)
  const { form, submit, pending } = useActionForm({
    schema: backupSettingsSchema,
    action: saveBackupSettings,
    defaultValues: { password: "", confirm: "", auto },
    successMessage: t("saved"),
    onSuccess: () => {
      form.reset({ ...form.getValues(), password: "", confirm: "" })
      setReplacing(false)
      setShown(false)
    },
  })

  const passwordInput = (name: "password" | "confirm", label: string) => (
    <FormField<BackupSettingsValues> name={name} label={label} required>
      {({ value, onChange, ...field }) => (
        <div className="relative" dir="ltr">
          <Input
            {...field}
            ref={field.ref}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            type={shown ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            spellCheck={false}
            className="pe-10 font-mono text-sm"
          />
          {name === "password" && (
            <button
              type="button"
              onClick={() => setShown((s) => !s)}
              aria-label={shown ? t("password.hide") : t("password.show")}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-0 flex w-10 items-center justify-center"
            >
              {shown ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </button>
          )}
        </div>
      )}
    </FormField>
  )

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("password.title")} description={t("password.description")}>
        {replacing ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {passwordInput("password", t("password.label"))}
              {passwordInput("confirm", t("password.confirm"))}
            </div>
            <p className="bg-warning/10 flex gap-2.5 rounded-lg p-3 text-sm text-pretty">
              <ShieldAlertIcon className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
              {t("password.warning")}
            </p>
            {hasPassword && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  form.setValue("password", "")
                  form.setValue("confirm", "")
                  form.clearErrors()
                  setReplacing(false)
                }}
              >
                {t("password.keep")}
              </Button>
            )}
          </>
        ) : (
          <div className="bg-muted/40 flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-1.5">
            <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
              <KeyRoundIcon className="text-success size-4 shrink-0" aria-hidden />
              {t("password.saved")}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setReplacing(true)}>
              {t("password.change")}
            </Button>
          </div>
        )}
      </FormSection>

      <FormSection title={t("auto.title")} description={t("auto.description")}>
        <FormField<BackupSettingsValues> name="auto">
          {(field) => (
            <label className="flex items-start justify-between gap-4 rounded-xl border p-4">
              <span className="space-y-1">
                <span className="block text-sm font-medium">{t("auto.label")}</span>
                <span className="text-muted-foreground block text-sm text-pretty">{t("auto.hint")}</span>
              </span>
              <Switch
                id={field.id}
                ref={field.ref}
                checked={Boolean(field.value)}
                onCheckedChange={(v) => {
                  field.onChange(v)
                  field.onBlur()
                }}
              />
            </label>
          )}
        </FormField>
      </FormSection>

      <FormActions>
        <SubmitButton pending={pending} disabled={!form.formState.isDirty}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}

/** "Back up now": the whole database into today's folder. */
export function ManualBackupButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations("settings.backup")
  const tc = useTranslations("common")
  const [pending, start] = useTransition()
  return (
    <Button
      size="lg"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          try {
            const result = await createManualBackup({})
            if (!result) return
            if (result.ok) toast.success(t("manual.done"))
            else toast.error(result.error)
          } catch {
            toast.error(tc("errors.network"))
          }
        })
      }
    >
      {pending ? <Spinner aria-hidden /> : <DatabaseBackupIcon aria-hidden />}
      {pending ? t("manual.running") : t("manual.action")}
    </Button>
  )
}

/** The file name a download is offered under (the Persian one when given). */
function fileName(response: Response, fallback: string) {
  const header = response.headers.get("content-disposition") ?? ""
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (utf8) return decodeURIComponent(utf8[1])
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback
}

/**
 * A download made on the server (Excel or ZIP), which can take a few seconds:
 * the button shows that it is working, and says so when it failed.
 */
export function DownloadButton({
  href,
  label,
  icon = "excel",
  variant = "outline",
  disabled,
  className,
}: {
  href: string
  label: string
  icon?: "excel" | "zip"
  variant?: "outline" | "default" | "secondary"
  disabled?: boolean
  className?: string
}) {
  const t = useTranslations("settings.backup")
  const [pending, setPending] = useState(false)
  const Icon = icon === "zip" ? FolderArchiveIcon : FileSpreadsheetIcon
  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled || pending}
      className={cn("justify-start", className)}
      onClick={async () => {
        setPending(true)
        try {
          const response = await fetch(href, { credentials: "same-origin" })
          if (!response.ok) throw new Error(String(response.status))
          const url = URL.createObjectURL(await response.blob())
          const a = document.createElement("a")
          a.href = url
          a.download = fileName(response, "limer")
          document.body.append(a)
          a.click()
          a.remove()
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
        } catch {
          toast.error(t("downloads.failed"))
        } finally {
          setPending(false)
        }
      }}
    >
      {pending ? <Spinner aria-hidden /> : <Icon className="size-4" />}
      {pending ? t("downloads.preparing") : label}
    </Button>
  )
}

/** A choice (a workshop, a month) and the button that downloads its report. */
export function PickAndDownload({
  kind,
  param,
  options,
  label,
  placeholder,
}: {
  kind: "workshop" | "month"
  param: "id" | "m"
  options: { value: string; label: string }[]
  label: string
  placeholder: string
}) {
  const [value, setValue] = useState(options[0]?.value ?? "")
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <NativeSelect className="w-full min-w-0 sm:flex-1" value={value} onChange={(e) => setValue(e.target.value)} aria-label={placeholder}>
        {options.length === 0 && <NativeSelectOption value="">{placeholder}</NativeSelectOption>}
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <DownloadButton href={`/api/admin/exports/${kind}?${param}=${encodeURIComponent(value)}`} label={label} disabled={!value} className="shrink-0" />
    </div>
  )
}
