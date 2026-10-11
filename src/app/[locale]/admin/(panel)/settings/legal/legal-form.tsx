"use client"

import { useTranslations } from "next-intl"

import { Form, FormActions, FormSection, SubmitButton, TextareaField, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { saveLegalSettings } from "@/features/settings/legal-actions"
import { legalSettingsSchema, type LegalSettingsValues } from "@/features/settings/legal-schema"

/** The business behind the site: who sells, where, how to reach them. Shown on the legal pages and the Contact page. */
export function LegalSettingsForm({ saved }: { saved: LegalSettingsValues }) {
  const t = useTranslations("settings.legal")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const { form, submit, pending } = useActionForm({
    schema: legalSettingsSchema,
    action: saveLegalSettings,
    defaultValues: saved,
    successMessage: ts("toast.saved"),
    onSuccess: () => form.reset(form.getValues()),
  })

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("business.title")} description={t("business.description")}>
        <TextField<LegalSettingsValues> name="legalName" label={t("legalName")} description={t("legalNameHint")} maxLength={200} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField<LegalSettingsValues> name="taxOffice" label={t("taxOffice")} maxLength={100} />
          <TextField<LegalSettingsValues> name="taxNumber" label={t("taxNumber")} description={t("taxNumberHint")} inputMode="numeric" dir="ltr" maxLength={11} />
        </div>
        <TextField<LegalSettingsValues> name="mersis" label={t("mersis")} description={t("optional")} inputMode="numeric" dir="ltr" maxLength={16} />
      </FormSection>

      <FormSection title={t("contact.title")} description={t("contact.description")}>
        <TextareaField<LegalSettingsValues> name="address" label={t("address")} rows={3} maxLength={500} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField<LegalSettingsValues> name="phone" label={t("phone")} type="tel" dir="ltr" maxLength={40} />
          <TextField<LegalSettingsValues> name="email" label={t("email")} type="email" dir="ltr" maxLength={254} />
        </div>
        <TextField<LegalSettingsValues> name="kep" label={t("kep")} description={t("optional")} type="email" dir="ltr" maxLength={254} />
      </FormSection>

      <FormActions>
        <SubmitButton pending={pending} disabled={!form.formState.isDirty}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}
