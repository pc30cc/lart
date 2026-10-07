"use client"

import {
  CircleCheckIcon,
  CircleXIcon,
  CloudIcon,
  HardDriveIcon,
  InfoIcon,
  KeyRoundIcon,
  PlugZapIcon,
  RabbitIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { useFormContext, useWatch, type Path } from "react-hook-form"
import { toast } from "sonner"

import { Form, FormActions, FormField, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { saveStorageSettings, testStorageSettings } from "@/features/settings/actions"
import {
  bunnyRegions,
  cdnProviders,
  cdnSettingsSchema,
  type CdnProvider,
  type CdnSettingsInput,
  type CdnView,
} from "@/features/settings/schema"
import type { StorageTestResult } from "@/lib/storage"
import { cn } from "@/lib/utils"
import { ChoiceCards } from "./fields"

/** Every field of every provider, so switching provider keeps what was typed. */
type Values = {
  provider: CdnProvider
  storageHost: string
  publicZone: string
  publicZoneKey: string
  publicHost: string
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  publicBucket: string
}
type FieldName = Exclude<keyof Values, "provider">

const providerIcons = { local: HardDriveIcon, bunny: RabbitIcon, cloudflare: CloudIcon } satisfies Record<CdnProvider, unknown>

function initialValues(view: CdnView): Values {
  const v = (field: string) => view.values[field] ?? ""
  return {
    provider: view.provider,
    storageHost: v("storageHost") || "storage.bunnycdn.com",
    publicZone: v("publicZone"),
    publicZoneKey: "",
    publicHost: v("publicHost"),
    accountId: v("accountId"),
    accessKeyId: "",
    secretAccessKey: "",
    publicBucket: v("publicBucket"),
  }
}

/** Where uploads are stored: provider, its fields and keys, "Test connection" and save. */
export function StorageSettingsForm({ view }: { view: CdnView }) {
  const t = useTranslations("settings.storage")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const [saved, setSaved] = useState({ provider: view.provider, keys: view.saved })
  // Bumped after a save, so the key fields go back to "saved" mode.
  const [round, setRound] = useState(0)
  const [test, setTest] = useState<StorageTestResult | null>(null)
  const [testing, startTest] = useTransition()

  const { form, submit, pending } = useActionForm({
    schema: cdnSettingsSchema,
    action: (values: CdnSettingsInput) => saveStorageSettings(values),
    defaultValues: initialValues(view) as CdnSettingsInput,
    successMessage: ts("toast.saved"),
    onSuccess: (data) => {
      const provider = form.getValues("provider")
      setSaved({ provider, keys: data.saved })
      setRound((n) => n + 1)
      const values = form.getValues() as Values
      form.reset({ ...values, publicZoneKey: "", accessKeyId: "", secretAccessKey: "" })
    },
  })
  const provider = useWatch({ control: form.control, name: "provider" }) as CdnProvider
  const keySaved = (field: FieldName) => provider === saved.provider && saved.keys.includes(field)

  function runTest() {
    setTest(null)
    startTest(async () => {
      if (!(await form.trigger())) return
      try {
        const result = await testStorageSettings(form.getValues())
        if (!result) return
        if (result.ok) setTest(result.data)
        else {
          Object.entries(result.fieldErrors ?? {}).forEach(([path, message], i) =>
            form.setError(path as Path<CdnSettingsInput>, { type: "server", message }, { shouldFocus: i === 0 }),
          )
          toast.error(result.error)
        }
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  const secret = (field: FieldName, hint?: string) => (
    <SecretField key={`${field}-${round}-${provider}`} name={field} label={t(`fields.${field}`)} hint={hint} saved={keySaved(field)} />
  )

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("providerTitle")} description={t("providerDescription")}>
        <FormField<Values> name="provider" label={t("provider")} required>
          {(field) => (
            <ChoiceCards
              id={field.id}
              value={field.value as CdnProvider}
              onChange={(v) => {
                field.onChange(v)
                setTest(null)
              }}
              describedBy={field["aria-describedby"]}
              choices={cdnProviders.map((p) => ({
                value: p,
                title: t(`providers.${p}.title`),
                description: t(`providers.${p}.hint`),
                icon: providerIcons[p],
              }))}
            />
          )}
        </FormField>
        {provider !== saved.provider && (
          <Note tone="warning" icon={InfoIcon}>
            {t("switchWarning")}
          </Note>
        )}
        {provider === "local" && <Note icon={InfoIcon}>{t("localNote")}</Note>}
      </FormSection>

      {provider === "bunny" && (
        <FormSection title={t("bunnyTitle")} description={t("bunnyDescription")}>
          <FormField<Values> name="storageHost" label={t("fields.storageHost")} description={t("hints.storageHost")} required>
            {(field) => (
              <Select
                value={field.value as string}
                onValueChange={(v) => {
                  field.onChange(v)
                  field.onBlur()
                  setTest(null)
                }}
              >
                <SelectTrigger id={field.id} ref={field.ref} aria-describedby={field["aria-describedby"]} className="w-full sm:max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bunnyRegions.map((r) => (
                    <SelectItem key={r.host} value={r.host}>
                      {t(`regions.${r.region}`)} <span className="text-muted-foreground font-mono text-xs" dir="ltr">{r.host}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <PlainField name="publicZone" label={t("fields.publicZone")} />
          {secret("publicZoneKey", t("hints.bunnyKey"))}
          <PlainField name="publicHost" label={t("fields.publicHost")} hint={t("hints.bunnyHost")} placeholder="cdn.example.com" />
        </FormSection>
      )}

      {provider === "cloudflare" && (
        <FormSection title={t("cloudflareTitle")} description={t("cloudflareDescription")}>
          <PlainField name="accountId" label={t("fields.accountId")} hint={t("hints.accountId")} />
          {secret("accessKeyId", t("hints.r2Keys"))}
          {secret("secretAccessKey")}
          <PlainField name="publicBucket" label={t("fields.publicBucket")} />
          <PlainField name="publicHost" label={t("fields.publicHost")} hint={t("hints.r2Host")} placeholder="cdn.example.com" />
        </FormSection>
      )}

      <div aria-live="polite">
        {test && (
          <Note tone={test.ok ? "success" : "danger"} icon={test.ok ? CircleCheckIcon : CircleXIcon}>
            {test.ok ? t("test.ok") : t(`test.${test.step}`)}
          </Note>
        )}
      </div>

      <FormActions>
        <Button type="button" variant="outline" size="lg" className="px-4" onClick={runTest} disabled={testing || pending}>
          {testing ? <Spinner aria-hidden /> : <PlugZapIcon />}
          {testing ? t("test.running") : t("test.action")}
        </Button>
        <SubmitButton pending={pending} disabled={!form.formState.isDirty || testing}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}

function PlainField({ name, label, hint, placeholder }: { name: FieldName; label: string; hint?: string; placeholder?: string }) {
  return (
    <TextField<Values>
      name={name}
      label={label}
      description={hint}
      placeholder={placeholder}
      required
      dir="ltr"
      autoComplete="off"
      autoCapitalize="none"
      spellCheck={false}
      className="[&_input]:font-mono [&_input]:text-sm"
    />
  )
}

/**
 * A key field. A saved key is never shown or sent back: the field says
 * "Saved" with a Replace button; leaving it empty keeps the saved key.
 */
function SecretField({ name, label, hint, saved }: { name: FieldName; label: string; hint?: string; saved: boolean }) {
  const t = useTranslations("settings.storage")
  const { getValues, setValue } = useFormContext<Values>()
  // A key typed earlier (e.g. before switching provider and back) stays visible, so it is never sent unseen.
  const [replacing, setReplacing] = useState(() => !saved || Boolean(getValues(name)))

  return (
    <FormField<Values> name={name} label={label} description={hint} required={!saved}>
      {({ value, ...field }) =>
        replacing ? (
          <div className="flex gap-2">
            <Input
              {...field}
              ref={field.ref}
              value={(value as string) ?? ""}
              type="password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder={saved ? t("keyPlaceholderReplace") : undefined}
              className="font-mono text-sm"
              autoFocus={saved}
            />
            {saved && (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={() => {
                  setValue(name, "", { shouldDirty: true })
                  setReplacing(false)
                }}
              >
                {t("keepSaved")}
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-muted/40 flex h-9 items-center justify-between gap-3 rounded-lg border px-3">
            <span className="text-muted-foreground inline-flex min-w-0 items-center gap-2 text-sm">
              <KeyRoundIcon className="text-success size-4 shrink-0" />
              <span className="truncate">{t("keySaved")}</span>
            </span>
            <Button
              type="button"
              id={field.id}
              ref={field.ref}
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => setReplacing(true)}
            >
              {t("replaceKey")}
            </Button>
          </div>
        )
      }
    </FormField>
  )
}

const toneClass = {
  info: "border-info/25 bg-info/5 [&>svg]:text-info",
  warning: "border-warning/30 bg-warning/5 [&>svg]:text-warning",
  success: "border-success/30 bg-success/5 [&>svg]:text-success",
  danger: "border-destructive/30 bg-destructive/5 [&>svg]:text-destructive",
}

function Note({
  tone = "info",
  icon: Icon,
  children,
}: {
  tone?: keyof typeof toneClass
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className={cn("animate-in fade-in-0 flex gap-2.5 rounded-lg border p-3 text-sm duration-200", toneClass[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p className="text-pretty">{children}</p>
    </div>
  )
}
