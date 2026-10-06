"use client"

import { useTranslations } from "next-intl"

import { Form, FormActions, FormField, FormSection, SubmitButton } from "@/components/admin/form/form"
import { LocalizedInput, LocalizedTextarea } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { LocalizedText } from "@/db/schema"
import { saveGeneralSettings } from "@/features/settings/actions"
import {
  generalSettingsSchema,
  siteLocales,
  themes,
  type GeneralSettingsValues,
} from "@/features/settings/schema"
import { ChoiceCards } from "./fields"

type Saved = {
  brand: LocalizedText
  defaultLocale: (typeof siteLocales)[number]
  seo: { title: LocalizedText; description: LocalizedText }
  theme: string
}

const full = (text: LocalizedText) => ({ fa: text.fa ?? "", tr: text.tr ?? "", en: text.en ?? "" })

/** Brand name, default language, SEO defaults and theme: one form, one save. */
export function GeneralSettingsForm({ saved }: { saved: Saved }) {
  const t = useTranslations("settings.general")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")

  const { form, submit, pending } = useActionForm({
    schema: generalSettingsSchema,
    action: saveGeneralSettings,
    defaultValues: {
      brand: full(saved.brand),
      defaultLocale: saved.defaultLocale,
      seo: { title: full(saved.seo.title), description: full(saved.seo.description) },
      theme: (themes as readonly string[]).includes(saved.theme) ? (saved.theme as (typeof themes)[number]) : themes[0],
    },
    successMessage: ts("toast.saved"),
    onSuccess: () => form.reset(form.getValues()),
  })

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("brandTitle")} description={t("brandDescription", { token: "{brand}" })}>
        <LocalizedInput name="brand" label={t("brand")} required={siteLocales} maxLength={60} />
      </FormSection>

      <FormSection title={t("languageTitle")} description={t("languageDescription")}>
        <FormField<GeneralSettingsValues> name="defaultLocale" label={t("defaultLocale")} required>
          {(field) => (
            <ChoiceCards
              id={field.id}
              value={field.value as (typeof siteLocales)[number]}
              onChange={field.onChange}
              describedBy={field["aria-describedby"]}
              choices={siteLocales.map((l) => ({ value: l, title: tc(`locales.${l}`), lang: l }))}
            />
          )}
        </FormField>
      </FormSection>

      <FormSection title={t("seoTitle")} description={t("seoDescription")}>
        <LocalizedInput name="seo.title" label={t("seoPageTitle")} description={t("seoPageTitleHint")} maxLength={120} />
        <LocalizedTextarea
          name="seo.description"
          label={t("seoPageDescription")}
          description={t("seoPageDescriptionHint")}
          maxLength={300}
          rows={3}
        />
      </FormSection>

      <FormSection title={t("themeTitle")} description={t("themeDescription")}>
        <FormField<GeneralSettingsValues> name="theme" label={t("theme")} description={t("themeHint")}>
          {(field) => (
            <Select
              value={field.value as string}
              onValueChange={(v) => {
                field.onChange(v)
                field.onBlur()
              }}
            >
              <SelectTrigger id={field.id} ref={field.ref} aria-describedby={field["aria-describedby"]} className="w-full sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {themes.map((theme) => (
                  <SelectItem key={theme} value={theme}>
                    {t(`themes.${theme}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
