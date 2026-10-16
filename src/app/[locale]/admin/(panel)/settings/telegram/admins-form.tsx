"use client"

import { BellRingIcon, CircleCheckIcon, ClockIcon, ExternalLinkIcon, SendIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { PersonPlaceholder } from "@/components/person-placeholder"
import { Form, FormActions, FormField, FormSection, SubmitButton } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { saveTelegramAdmins, sendAdminTestAction } from "@/features/telegram/actions"
import { telegramAdminsSchema, type TelegramAdminsValues } from "@/features/telegram/schema"
import { locales } from "@/i18n/locales"
import { cn } from "@/lib/utils"
import { ChoiceCards } from "../_components/fields"

type Person = { adminId: string; name: string; username: string; connected: boolean }

/**
 * Settings → Telegram → Admins: the bot sends every new registration and
 * every transfer receipt (with the photo) to these admins, with "Confirm
 * payment". Each one is set by their Telegram username and connects by
 * pressing Start in the bot once.
 */
export function TelegramAdminsForm({
  people: initial,
  notify,
  locale,
  botUsername: savedBot,
  tokenSaved,
}: {
  people: Person[]
  notify: boolean
  locale: "fa" | "tr" | "en"
  botUsername: string
  tokenSaved: boolean
}) {
  const t = useTranslations("settings.telegram.admins")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const [people, setPeople] = useState(initial)
  const [bot, setBot] = useState(savedBot)
  const [testing, startTest] = useTransition()
  const { form, submit, pending } = useActionForm({
    schema: telegramAdminsSchema,
    action: saveTelegramAdmins,
    defaultValues: { notify, locale, people: initial.map((p) => ({ adminId: p.adminId, username: p.username })) },
    successMessage: ts("toast.saved"),
    onSuccess: (data) => {
      setBot(data.botUsername)
      setPeople((all) => all.map((p) => ({ ...p, connected: data.people.find((d) => d.adminId === p.adminId)?.connected ?? false })))
      form.reset(form.getValues())
    },
  })

  function runTest() {
    startTest(async () => {
      try {
        const result = await sendAdminTestAction({})
        if (result.ok) toast.success(t("test.sent", { count: result.data.sent }))
        else toast.error(result.error, { duration: 15_000 })
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  const startLink = bot ? `https://t.me/${bot}?start=admin` : null

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("title")} description={t("description")}>
        <ol className="text-muted-foreground list-decimal space-y-1.5 ps-5 text-sm leading-relaxed">
          <li>{t("step1")}</li>
          <li>{t("step2")}</li>
          <li>
            {startLink ? t("step3") : t("step3Later")}
            {startLink && (
              <a href={startLink} target="_blank" rel="noopener noreferrer" className="text-primary ms-1.5 inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline" dir="ltr">
                @{bot}
                <ExternalLinkIcon className="size-3.5" aria-hidden />
              </a>
            )}
          </li>
        </ol>

        <FormField<TelegramAdminsValues> name="notify">
          {(field) => (
            <label htmlFor={field.id} className="flex items-start justify-between gap-4 rounded-xl border p-3.5">
              <span className="flex gap-3">
                <BellRingIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">{t("notify")}</span>
                  <span className="text-muted-foreground block text-sm text-pretty">{t("notifyHint")}</span>
                </span>
              </span>
              <Switch
                id={field.id}
                checked={Boolean(field.value)}
                onCheckedChange={(checked) => {
                  field.onChange(checked)
                  field.onBlur()
                }}
              />
            </label>
          )}
        </FormField>

        <ul className="space-y-2.5">
          {people.map((p, i) => (
            <li key={p.adminId} className="bg-muted/30 flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <PersonPlaceholder className="size-9" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  {p.username ? (
                    <p className={cn("flex items-center gap-1 text-xs", p.connected ? "text-success" : "text-warning")}>
                      {p.connected ? <CircleCheckIcon className="size-3.5" aria-hidden /> : <ClockIcon className="size-3.5" aria-hidden />}
                      {p.connected ? t("connected") : t("waiting")}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">{t("none")}</p>
                  )}
                </div>
              </div>
              <FormField<TelegramAdminsValues> name={`people.${i}.username`} className="sm:w-60">
                {({ value, ...field }) => (
                  <div className="relative" dir="ltr">
                    <span className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm">@</span>
                    <Input
                      {...field}
                      value={String(value ?? "").replace(/^@/, "")}
                      onChange={(e) => field.onChange(e.target.value.replace(/^@/, ""))}
                      placeholder="username"
                      autoComplete="off"
                      maxLength={33}
                      aria-label={t("usernameOf", { name: p.name })}
                      className="ps-7"
                    />
                  </div>
                )}
              </FormField>
            </li>
          ))}
        </ul>

        <FormField<TelegramAdminsValues> name="locale" label={t("locale")} description={t("localeHint")}>
          {(field) => (
            <ChoiceCards
              id={field.id}
              value={field.value as (typeof locales)[number]}
              onChange={field.onChange}
              describedBy={field["aria-describedby"]}
              choices={locales.map((l) => ({ value: l, title: tc(`locales.${l}`), lang: l }))}
            />
          )}
        </FormField>
      </FormSection>

      <FormActions>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="px-4"
          onClick={runTest}
          disabled={testing || pending || !tokenSaved || !people.some((p) => p.connected) || form.formState.isDirty}
        >
          {testing ? <Spinner aria-hidden /> : <SendIcon className="rtl:-scale-x-100" />}
          {testing ? t("test.running") : t("test.action")}
        </Button>
        <SubmitButton pending={pending} disabled={!form.formState.isDirty || testing || !tokenSaved}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}
