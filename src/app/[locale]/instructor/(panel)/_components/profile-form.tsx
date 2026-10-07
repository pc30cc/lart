"use client"

import { useTranslations } from "next-intl"

import { Form, FormActions, FormField, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { LocalizedInput, LocalizedTextarea } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { LanguagePicker } from "@/components/language-picker"
import type { LocalizedText } from "@/db/schema"
import { updateProfileAction } from "@/features/instructor-panel/actions"
import { profileSchema, type ProfileValues } from "@/features/instructor-panel/schema"
import { useRouter } from "@/i18n/navigation"
// The same searchable language list the admins use.
import { PhotoField } from "./photo-field"

export type EditableProfile = {
  displayName: LocalizedText
  teachingField: LocalizedText
  bio: LocalizedText | null
  teachingLanguages: string[]
  website: string | null
  photoPath: string | null
  photoUrl: string | null
}

const texts = (t: LocalizedText | null | undefined) => ({ fa: t?.fa ?? "", tr: t?.tr ?? "", en: t?.en ?? "" })

/**
 * Big, phone-friendly controls (44px inputs, 16px text, taller language tabs)
 * on each field, not on the whole section: that would also reach the photo's
 * hidden file input. `!` because TabsList sets its height twice.
 */
const big = "[&_input]:h-11 [&_input]:text-base [&_textarea]:text-base [&_[data-slot=tabs-list]]:h-10!"

/** The instructor's public profile: what visitors of the site will see. */
export function ProfileForm({ profile }: { profile: EditableProfile }) {
  const t = useTranslations("instructorPanel.profile")
  const router = useRouter()
  const { form, submit, pending } = useActionForm({
    schema: profileSchema,
    action: updateProfileAction,
    defaultValues: {
      displayName: texts(profile.displayName),
      teachingField: texts(profile.teachingField),
      bio: texts(profile.bio),
      teachingLanguages: profile.teachingLanguages as ProfileValues["teachingLanguages"],
      website: profile.website ?? "",
      photoPath: profile.photoPath,
    },
    successMessage: t("saved"),
    onSuccess: () => router.refresh(),
  })

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("public.title")} description={t("public.description")}>
        <LocalizedInput
          name="displayName"
          label={t("fields.displayName")}
          description={t("fields.displayNameHint")}
          required={["tr", "en"]}
          maxLength={80}
          className={big}
        />
        <LocalizedInput
          name="teachingField"
          label={t("fields.teachingField")}
          description={t("fields.teachingFieldHint")}
          required={["tr", "en"]}
          maxLength={80}
          className={big}
        />
        <FormField<ProfileValues> name="photoPath" label={t("fields.photo")} description={t("fields.photoHint")}>
          {(field) => <PhotoField {...field} previewUrl={profile.photoUrl} />}
        </FormField>
        <LocalizedTextarea
          name="bio"
          label={t("fields.bio")}
          description={t("fields.bioHint")}
          maxLength={600}
          rows={5}
          className={big}
        />
        <FormField<ProfileValues>
          name="teachingLanguages"
          label={t("fields.teachingLanguages")}
          description={t("fields.teachingLanguagesHint")}
          className="[&_[role=combobox]]:h-11 [&_[role=combobox]]:text-base"
        >
          {(field) => <LanguagePicker {...field} />}
        </FormField>
        <TextField<ProfileValues>
          name="website"
          label={t("fields.website")}
          description={t("fields.websiteHint")}
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://"
          dir="ltr"
          maxLength={300}
          className={big}
        />
      </FormSection>
      <FormActions className="border-t-0 pt-0">
        <SubmitButton pending={pending} className="h-12 w-full rounded-xl text-base sm:w-auto sm:px-8">
          {t("save")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}
