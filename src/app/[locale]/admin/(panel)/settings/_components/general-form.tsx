"use client"

import { useTranslations } from "next-intl"

import { Form, FormActions, FormField, FormSection, SubmitButton } from "@/components/admin/form/form"
import { LocalizedInput, LocalizedTextarea } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import type { LocalizedText } from "@/db/schema"
import { saveGeneralSettings } from "@/features/settings/actions"
import { generalSettingsSchema, siteLocales, type GeneralSettingsValues } from "@/features/settings/schema"
import { ChoiceCards } from "./fields"

type Saved = {
  brand: LocalizedText
  defaultLocale: (typeof siteLocales)[number]
  seo: { title: LocalizedText; description: LocalizedText }
}

const full = (text: LocalizedText) => ({ fa: text.fa ?? "", tr: text.tr ?? "", en: text.en ?? "" })

/** Brand name, default language and SEO defaults: one form, one save (the theme is under Appearance). */
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

      <FormActions>
        <SubmitButton pending={pending} disabled={!form.formState.isDirty}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}
