"use client"

import { LockKeyholeIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { useWatch } from "react-hook-form"
import { toast } from "sonner"

import { Form, FormActions, FormField, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { PasswordField } from "@/components/admin/form/password-field"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { ImageUpload } from "@/components/admin/upload"
import { updateMyProfile } from "@/features/partners/actions"
import type { MyProfile } from "@/features/partners/queries"
import { profileSchema, type ProfileValues } from "@/features/partners/schema"

const normalize = (email: string | undefined) => (email ?? "").trim().toLowerCase()

/**
 * My profile: photo, name and email. A new email asks for the current
 * password (the field appears as soon as the email differs from the saved one).
 * After saving, the header's name and photo update (the action revalidates the panel).
 */
export function ProfileForm({ profile }: { profile: MyProfile }) {
  const t = useTranslations("partners.profile")
  const tc = useTranslations("common")
  const [savedEmail, setSavedEmail] = useState(profile.email)

  const { form, submit, pending } = useActionForm({
    schema: profileSchema,
    action: updateMyProfile,
    defaultValues: { name: profile.name, email: profile.email, photoPath: profile.photoPath, currentPassword: "" },
    successMessage: false,
    onSuccess: ({ emailChanged }) => {
      toast.success(emailChanged ? t("savedEmail") : t("saved"))
      const values = form.getValues()
      setSavedEmail(normalize(values.email))
      form.reset({ ...values, email: normalize(values.email), currentPassword: "" })
    },
  })
  const email = useWatch({ control: form.control, name: "email" })
  const emailChanging = normalize(email) !== savedEmail

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("photo.title")} description={t("photo.description")}>
        <FormField<ProfileValues> name="photoPath" label={t("photo.label")} description={t("photo.hint")}>
          {({ value, onChange, ...field }) => (
            <ImageUpload
              {...field}
              purpose="admin_photo"
              value={value as string | null}
              onChange={(path) => onChange(path)}
              previewUrl={value && value === profile.photoPath ? profile.photoUrl : null}
            />
          )}
        </FormField>
      </FormSection>

      <FormSection title={t("details.title")} description={t("details.description")}>
        <TextField<ProfileValues>
          name="name"
          label={t("details.name")}
          description={t("details.nameHint")}
          autoComplete="name"
          maxLength={80}
          className="[&_input]:h-10"
        />
        <TextField<ProfileValues>
          name="email"
          label={t("details.email")}
          description={t("details.emailHint")}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          maxLength={254}
          className="[&_input]:h-10"
        />
        {emailChanging && (
          <div className="bg-muted/50 animate-in fade-in-0 space-y-3 rounded-lg p-4">
            <p className="flex items-start gap-2 text-sm text-pretty">
              <LockKeyholeIcon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              {t("details.emailChange")}
            </p>
            <PasswordField<ProfileValues>
              name="currentPassword"
              label={t("details.currentPassword")}
              autoComplete="current-password"
            />
          </div>
        )}
      </FormSection>

      <FormActions>
        <SubmitButton pending={pending}>{tc("actions.saveChanges")}</SubmitButton>
      </FormActions>
    </Form>
  )
}
