"use client"

import { ExternalLinkIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useWatch } from "react-hook-form"

import { Form, FormActions, FormField, FormSection, SubmitButton } from "@/components/admin/form/form"
import { LocalizedInput, LocalizedTextarea } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { ImageUpload } from "@/components/admin/upload"
import { Switch } from "@/components/ui/switch"
import type { LocalizedText } from "@/db/schema"
import { updateMyAbout } from "@/features/partners/actions"
import type { MyAbout } from "@/features/partners/queries"
import {
  ABOUT_BIO_MAX,
  ABOUT_NAME_MAX,
  ABOUT_ROLE_MAX,
  aboutProfileSchema,
  type AboutProfileValues,
} from "@/features/partners/schema"
import { Link } from "@/i18n/navigation"
import { locales } from "@/i18n/routing"

/** A localized text with every language present (the form's inputs are controlled). */
const all = (text: LocalizedText) => ({ fa: text.fa ?? "", tr: text.tr ?? "", en: text.en ?? "" })

/**
 * My entry on the public Our story page: whether I am shown, a portrait (public,
 * separate from the panel's photo), my name, role and a few words about me in
 * Persian, Turkish and English. While shown, the words are needed in all
 * three; a hidden entry can be saved half-written.
 */
export function AboutForm({ about }: { about: MyAbout }) {
  const t = useTranslations("partners.about")
  const tc = useTranslations("common")

  const { form, submit, pending } = useActionForm({
    schema: aboutProfileSchema,
    action: updateMyAbout,
    defaultValues: {
      aboutShown: about.aboutShown,
      aboutName: all(about.aboutName),
      aboutRole: all(about.aboutRole),
      aboutBio: all(about.aboutBio),
      portraitPath: about.portraitPath,
    },
    successMessage: t("saved"),
    onSuccess: () => form.reset(form.getValues()),
  })
  const shown = useWatch({ control: form.control, name: "aboutShown" })

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("title")} description={t("description")}>
        <FormField<AboutProfileValues> name="aboutShown" description={t("showHint")}>
          {(field) => (
            <div className="flex items-center justify-between gap-4">
              <label htmlFor={field.id} className="cursor-pointer text-sm font-medium">
                {t("show")}
              </label>
              <Switch
                id={field.id}
                ref={field.ref}
                checked={Boolean(field.value)}
                aria-describedby={field["aria-describedby"]}
                onCheckedChange={(checked) => {
                  field.onChange(checked)
                  field.onBlur()
                }}
              />
            </div>
          )}
        </FormField>
        <Link
          href="/story"
          target="_blank"
          rel="noopener"
          className="text-primary inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
        >
          {t("viewPage")}
          <ExternalLinkIcon className="size-3.5" aria-hidden />
        </Link>

        <FormField<AboutProfileValues> name="portraitPath" label={t("portrait")} description={t("portraitHint")}>
          {({ value, onChange, ...field }) => (
            <ImageUpload
              {...field}
              purpose="partner_portrait"
              value={value as string | null}
              onChange={(path) => onChange(path)}
              previewUrl={value && value === about.portraitPath ? about.portraitUrl : null}
            />
          )}
        </FormField>

        <LocalizedInput name="aboutName" label={t("name")} description={t("nameHint")} placeholder={about.name} maxLength={ABOUT_NAME_MAX} />
        <LocalizedInput name="aboutRole" label={t("role")} description={t("roleHint")} maxLength={ABOUT_ROLE_MAX} />
        <LocalizedTextarea
          name="aboutBio"
          label={t("bio")}
          description={t("bioHint")}
          required={shown ? locales : []}
          maxLength={ABOUT_BIO_MAX}
          rows={7}
        />
      </FormSection>

      <FormActions>
        <SubmitButton pending={pending}>{tc("actions.saveChanges")}</SubmitButton>
      </FormActions>
    </Form>
  )
}
