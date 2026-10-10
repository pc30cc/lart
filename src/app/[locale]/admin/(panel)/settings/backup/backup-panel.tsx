"use client"

import { DatabaseBackupIcon, FileSpreadsheetIcon, FolderArchiveIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Form, FormActions, FormField, FormSection, SubmitButton } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { createManualBackup, saveBackupSettings } from "@/features/backup/actions"
import { backupSettingsSchema, type BackupSettingsValues } from "@/features/backup/schema"
import { cn } from "@/lib/utils"

/** The switch for the automatic daily backups. */
export function BackupSettingsForm({ auto }: { auto: boolean }) {
  const t = useTranslations("settings.backup")
  const tc = useTranslations("common")
  const { form, submit, pending } = useActionForm({
    schema: backupSettingsSchema,
    action: saveBackupSettings,
    defaultValues: { auto },
    successMessage: t("saved"),
    onSuccess: () => form.reset(form.getValues()),
  })

  return (
    <Form form={form} onSubmit={submit}>
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
export function ManualBackupButton() {
  const t = useTranslations("settings.backup")
  const tc = useTranslations("common")
  const [pending, start] = useTransition()
  return (
    <Button
      size="lg"
      disabled={pending}
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
