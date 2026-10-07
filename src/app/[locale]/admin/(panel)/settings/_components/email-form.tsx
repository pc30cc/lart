"use client"

import { CircleCheckIcon, InfoIcon, KeyRoundIcon, SendIcon, ServerIcon, ZapIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { useWatch, type Path } from "react-hook-form"
import { toast } from "sonner"

import { Form, FormActions, FormField, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { saveEmailSettings, testEmailSettings } from "@/features/settings/actions"
import {
  emailProviders,
  emailSettingsSchema,
  smtpDefaultPorts,
  smtpSecurities,
  type EmailProvider,
  type EmailSettingsInput,
  type EmailView,
  type SmtpSecurity,
} from "@/features/settings/schema"
import { cn } from "@/lib/utils"
import { ChoiceCards } from "./fields"

const providerIcons = { resend: ZapIcon, smtp: ServerIcon } satisfies Record<EmailProvider, unknown>

function initialValues(view: EmailView): EmailSettingsInput {
  return {
    // Not set yet: the server's RESEND_API_KEY was in use, which is Resend.
    provider: view.provider === "env" ? "resend" : view.provider,
    fromAddress: view.fromAddress || view.server.fromAddress,
    replyTo: view.replyTo,
    resendKey: "",
    smtpHost: view.smtp.host,
    smtpPort: view.smtp.port,
    smtpSecurity: view.smtp.security,
    smtpUser: view.smtp.user,
    smtpPassword: "",
  }
}

/** How emails are sent: Resend or an SMTP server, the sender, "Send a test email" and save. */
export function EmailSettingsForm({ view, adminEmail }: { view: EmailView; adminEmail: string }) {
  const t = useTranslations("settings.email")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const [saved, setSaved] = useState(view.saved)
  // Bumped after a save, so the secret fields go back to "saved" mode.
  const [round, setRound] = useState(0)
  const [tested, setTested] = useState<string | null>(null)
  const [testing, startTest] = useTransition()

  const { form, submit, pending } = useActionForm({
    schema: emailSettingsSchema,
    action: (values: EmailSettingsInput) => saveEmailSettings(values),
    defaultValues: initialValues(view),
    successMessage: ts("toast.saved"),
    onSuccess: (data) => {
      setSaved(data.saved)
      setRound((n) => n + 1)
      form.reset({ ...form.getValues(), resendKey: "", smtpPassword: "" })
    },
  })
  const provider = useWatch({ control: form.control, name: "provider" }) as EmailProvider
  const user = useWatch({ control: form.control, name: "smtpUser" }) as string

  function runTest() {
    setTested(null)
    startTest(async () => {
      if (!(await form.trigger())) return
      try {
        const result = await testEmailSettings(form.getValues())
        if (!result) return
        if (result.ok) setTested(result.data.to)
        else {
          Object.entries(result.fieldErrors ?? {}).forEach(([path, message], i) =>
            form.setError(path as Path<EmailSettingsInput>, { type: "server", message }, { shouldFocus: i === 0 }),
          )
          toast.error(result.error, { duration: 15_000 })
        }
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("providerTitle")} description={t("providerDescription")}>
        <FormField<EmailSettingsInput> name="provider" label={t("provider")} required>
          {(field) => (
            <ChoiceCards
              id={field.id}
              value={field.value as EmailProvider}
              onChange={(v) => {
                field.onChange(v)
                setTested(null)
              }}
              describedBy={field["aria-describedby"]}
              className="sm:grid-cols-2"
              choices={emailProviders.map((p) => ({
                value: p,
                title: t(`providers.${p}.title`),
                description: t(`providers.${p}.hint`),
                icon: providerIcons[p],
              }))}
            />
          )}
        </FormField>
        {view.provider === "env" && <Note icon={InfoIcon}>{t("serverNote")}</Note>}
      </FormSection>

      <FormSection title={t("senderTitle")} description={t("senderDescription")}>
        <Plain name="fromAddress" label={t("fields.fromAddress")} hint={t("hints.fromAddress")} placeholder="hello@example.com" required />
        <Plain name="replyTo" label={t("fields.replyTo")} hint={t("hints.replyTo")} placeholder="info@example.com" />
      </FormSection>

      {provider === "resend" && (
        <FormSection title={t("resendTitle")} description={t("resendDescription")}>
          <Secret
            key={`resendKey-${round}`}
            name="resendKey"
            label={t("fields.resendKey")}
            hint={saved.resendKey ? t("hints.resendKey") : view.server.resendKey ? t("hints.resendKeyServer") : t("hints.resendKey")}
            saved={saved.resendKey}
            required={!saved.resendKey && !view.server.resendKey}
          />
        </FormSection>
      )}

      {provider === "smtp" && (
        <FormSection title={t("smtpTitle")} description={t("smtpDescription")}>
          <Plain name="smtpHost" label={t("fields.smtpHost")} hint={t("hints.smtpHost")} placeholder="smtp.example.com" required />
          <div className="grid gap-6 sm:grid-cols-2">
            <FormField<EmailSettingsInput> name="smtpSecurity" label={t("fields.smtpSecurity")} required>
              {(field) => (
                <Select
                  value={field.value as string}
                  onValueChange={(v) => {
                    const security = v as SmtpSecurity
                    field.onChange(security)
                    field.onBlur()
                    // The usual port of that security, unless a custom one was typed.
                    const port = form.getValues("smtpPort")
                    if ((Object.values(smtpDefaultPorts) as number[]).includes(port)) {
                      form.setValue("smtpPort", smtpDefaultPorts[security], { shouldDirty: true })
                    }
                  }}
                >
                  <SelectTrigger id={field.id} ref={field.ref} aria-describedby={field["aria-describedby"]} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {smtpSecurities.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`security.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField<EmailSettingsInput> name="smtpPort" label={t("fields.smtpPort")} required>
              {({ value, onChange, ...field }) => (
                <Input
                  {...field}
                  ref={field.ref}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={65535}
                  dir="ltr"
                  value={String(value ?? "")}
                  onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                  className="font-mono text-sm"
                />
              )}
            </FormField>
          </div>
          <Plain name="smtpUser" label={t("fields.smtpUser")} hint={t("hints.smtpUser")} />
          {user.trim() !== "" && (
            <Secret
              key={`smtpPassword-${round}`}
              name="smtpPassword"
              label={t("fields.smtpPassword")}
              saved={saved.smtpPassword}
              required={!saved.smtpPassword}
            />
          )}
          <Note icon={InfoIcon}>{t("smtpNote")}</Note>
        </FormSection>
      )}

      <div aria-live="polite">
        {tested && (
          <Note tone="success" icon={CircleCheckIcon}>
            {t("test.sent", { email: `⁨${tested}⁩` })}
          </Note>
        )}
      </div>

      <FormActions>
        <Button type="button" variant="outline" size="lg" className="px-4" onClick={runTest} disabled={testing || pending}>
          {testing ? <Spinner aria-hidden /> : <SendIcon className="rtl:-scale-x-100" />}
          {testing ? t("test.running") : t("test.action", { email: adminEmail })}
        </Button>
        <SubmitButton pending={pending} disabled={!form.formState.isDirty || testing}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}

type PlainName = "fromAddress" | "replyTo" | "smtpHost" | "smtpUser"

function Plain({ name, label, hint, placeholder, required }: { name: PlainName; label: string; hint?: string; placeholder?: string; required?: boolean }) {
  return (
    <TextField<EmailSettingsInput>
      name={name}
      label={label}
      description={hint}
      placeholder={placeholder}
      required={required}
      dir="ltr"
      autoComplete="off"
      autoCapitalize="none"
      spellCheck={false}
      maxLength={254}
      className="[&_input]:font-mono [&_input]:text-sm"
    />
  )
}

/**
 * A key or password. A saved one is never shown or sent back: the field says
 * "Saved" with a Replace button; leaving it empty keeps the saved one.
 */
function Secret({
  name,
  label,
  hint,
  saved,
  required,
}: {
  name: "resendKey" | "smtpPassword"
  label: string
  hint?: string
  saved: boolean
  required: boolean
}) {
  const t = useTranslations("settings.email")
  const [replacing, setReplacing] = useState(!saved)

  return (
    <FormField<EmailSettingsInput> name={name} label={label} description={hint} required={required}>
      {({ value, onChange, ...field }) =>
        replacing ? (
          <div className="flex gap-2">
            <Input
              {...field}
              ref={field.ref}
              value={(value as string) ?? ""}
              onChange={(e) => onChange(e.target.value)}
              type="password"
              dir="ltr"
              autoComplete="new-password"
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
                  onChange("")
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
  success: "border-success/30 bg-success/5 [&>svg]:text-success",
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
