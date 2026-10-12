"use client"

import { CircleCheckIcon, SendIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Form, FormActions, FormField, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { saveTelegramSettings, sendTelegramTestAction } from "@/features/telegram/actions"
import { telegramSettingsSchema, type TelegramSettingsValues } from "@/features/telegram/schema"
import { locales } from "@/i18n/locales"
import { ChoiceCards } from "../_components/fields"

/**
 * The Telegram channel workshops are sent to: the bot's token (never shown
 * again once saved; empty keeps it), the channel and the language of the
 * posts, with the steps to set it up and "Send a test".
 */
export function TelegramSettingsForm({ saved }: { saved: { chatId: string; locale: "fa" | "tr" | "en"; tokenSaved: boolean } }) {
  const t = useTranslations("settings.telegram")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const [tokenSaved, setTokenSaved] = useState(saved.tokenSaved)
  const [testing, startTest] = useTransition()
  const { form, submit, pending } = useActionForm({
    schema: telegramSettingsSchema,
    action: saveTelegramSettings,
    defaultValues: { botToken: "", chatId: saved.chatId, locale: saved.locale },
    successMessage: ts("toast.saved"),
    onSuccess: (data) => {
      setTokenSaved(data.tokenSaved)
      form.reset({ ...form.getValues(), botToken: "" })
    },
  })

  function runTest() {
    startTest(async () => {
      try {
        const result = await sendTelegramTestAction({})
        if (result.ok) toast.success(t("test.sent"))
        else toast.error(result.error, { duration: 15_000 })
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("setup.title")} description={t("setup.description")}>
        <ol className="text-muted-foreground list-decimal space-y-1.5 ps-5 text-sm leading-relaxed">
          <li>{t("setup.step1")}</li>
          <li>{t("setup.step2")}</li>
          <li>{t("setup.step3")}</li>
          <li>{t("setup.step4")}</li>
        </ol>
      </FormSection>

      <FormSection title={t("bot.title")} description={t("bot.description")}>
        <TextField<TelegramSettingsValues>
          name="botToken"
          label={t("token")}
          description={tokenSaved ? (
            <span className="text-success inline-flex items-center gap-1.5">
              <CircleCheckIcon className="size-4" aria-hidden />
              {t("tokenSaved")}
            </span>
          ) : t("tokenHint")}
          type="password"
          autoComplete="off"
          dir="ltr"
          placeholder={tokenSaved ? "••••••••••" : "123456789:AA…"}
          maxLength={100}
        />
        <TextField<TelegramSettingsValues> name="chatId" label={t("chat")} description={t("chatHint")} dir="ltr" placeholder="@limer_atolye" maxLength={40} />
        <FormField<TelegramSettingsValues> name="locale" label={t("locale")} description={t("localeHint")}>
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
        <Button type="button" variant="outline" size="lg" className="px-4" onClick={runTest} disabled={testing || pending || !tokenSaved || form.formState.isDirty}>
          {testing ? <Spinner aria-hidden /> : <SendIcon className="rtl:-scale-x-100" />}
          {testing ? t("test.running") : t("test.action")}
        </Button>
        <SubmitButton pending={pending} disabled={!form.formState.isDirty || testing}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}
