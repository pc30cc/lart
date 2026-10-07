"use client"

import { LockIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"

import { Form, FormActions, FormField, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { LocalizedInput, LocalizedTextarea } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { ImageUpload } from "@/components/admin/upload"
import { LanguagePicker } from "@/components/language-picker"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { LocalizedText } from "@/db/schema"
import { createInstructor, updateInstructor } from "@/features/instructors/actions"
import {
  instructorEditSchema,
  instructorSchema,
  inviteLocales,
  type InstructorFormValues,
  type InviteLocale,
} from "@/features/instructors/schema"
import { Link, useRouter } from "@/i18n/navigation"
import type { ActionResult } from "@/lib/errors"

/** What the edit page passes in. The ID number is never sent to the browser, only its mask. */
export type EditableInstructor = {
  id: string
  displayName: LocalizedText
  teachingField: LocalizedText
  officialName: string
  idNumberMasked: string | null
  mobile: string
  email: string
  bio: LocalizedText | null
  teachingLanguages: string[]
  website: string | null
  photoPath: string | null
  photoUrl: string | null
}

type Saved = { id: string; invited?: boolean; inviteCancelled?: boolean }

const texts = (t: LocalizedText | null | undefined) => ({ fa: t?.fa ?? "", tr: t?.tr ?? "", en: t?.en ?? "" })

/** Create (no `instructor`) or edit an instructor. One page, required fields first. */
export function InstructorForm({ instructor }: { instructor?: EditableInstructor }) {
  const t = useTranslations("instructors")
  const tc = useTranslations("common")
  const locale = useLocale()
  const router = useRouter()

  const { form, submit, pending } = useActionForm({
    schema: instructor ? instructorEditSchema : instructorSchema,
    action: (values: InstructorFormValues): Promise<ActionResult<Saved>> =>
      instructor ? updateInstructor({ ...values, id: instructor.id }) : createInstructor(values),
    defaultValues: {
      displayName: texts(instructor?.displayName),
      teachingField: texts(instructor?.teachingField),
      officialName: instructor?.officialName ?? "",
      idNumber: "",
      mobile: instructor?.mobile ?? "",
      email: instructor?.email ?? "",
      bio: texts(instructor?.bio),
      teachingLanguages: (instructor?.teachingLanguages ?? []) as InstructorFormValues["teachingLanguages"],
      website: instructor?.website ?? "",
      photoPath: instructor?.photoPath ?? null,
      inviteLocale: instructor ? undefined : (inviteLocales.find((l) => l === locale) ?? "tr"),
    },
    successMessage: false,
    onSuccess: (saved) => {
      if (saved.invited === false) toast.warning(t("toast.createdNoEmail"))
      else if (saved.inviteCancelled) toast.info(t("toast.inviteCancelled"))
      else toast.success(instructor ? t("toast.updated") : t("toast.created"))
      router.push(`/admin/instructors/${saved.id}`)
    },
  })

  // The mask is wrapped in an LTR isolate (LRI…PDI) so an RTL sentence cannot
  // reorder its bullets and digits away from how the input shows it.
  const idHint = instructor
    ? instructor.idNumberMasked
      ? t("fields.idNumberKeep", { masked: `⁦${instructor.idNumberMasked}⁩` })
      : t("fields.idNumberKeepPlain")
    : t("fields.idNumberHint")

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("form.publicTitle")} description={t("form.publicDescription")}>
        <LocalizedInput
          name="displayName"
          label={t("fields.displayName")}
          description={t("fields.displayNameHint")}
          required={["tr", "en"]}
          maxLength={80}
        />
        <LocalizedInput
          name="teachingField"
          label={t("fields.teachingField")}
          description={t("fields.teachingFieldHint")}
          required={["tr", "en"]}
          maxLength={80}
        />
      </FormSection>

      <FormSection
        title={t("form.privateTitle")}
        description={
          <span className="flex gap-2">
            <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t("form.privateDescription")}
          </span>
        }
      >
        <TextField<InstructorFormValues>
          name="officialName"
          label={t("fields.officialName")}
          description={t("fields.officialNameHint")}
          required
          autoComplete="off"
          maxLength={120}
        />
        <TextField<InstructorFormValues>
          name="idNumber"
          label={t("fields.idNumber")}
          description={idHint}
          required={!instructor}
          placeholder={instructor?.idNumberMasked ?? undefined}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          maxLength={32}
          className="sm:max-w-sm [&_input]:font-mono [&_input]:tracking-wide"
        />
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField<InstructorFormValues>
            name="mobile"
            label={t("fields.mobile")}
            description={t("fields.mobileHint")}
            required
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="+90 5__ ___ __ __"
            dir="ltr"
            maxLength={24}
          />
          <TextField<InstructorFormValues>
            name="email"
            label={t("fields.email")}
            description={t("fields.emailHint")}
            required
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
            maxLength={254}
          />
        </div>
      </FormSection>

      <FormSection title={t("form.aboutTitle")} description={t("form.aboutDescription")}>
        <FormField<InstructorFormValues> name="photoPath" label={t("fields.photo")} description={t("fields.photoHint")}>
          {({ value, onChange, ...field }) => (
            <ImageUpload
              {...field}
              purpose="instructor_photo"
              value={value as string | null}
              onChange={(path) => onChange(path)}
              previewUrl={instructor?.photoUrl}
            />
          )}
        </FormField>
        <LocalizedTextarea name="bio" label={t("fields.bio")} description={t("fields.bioHint")} maxLength={600} rows={4} />
        <FormField<InstructorFormValues>
          name="teachingLanguages"
          label={t("fields.teachingLanguages")}
          description={t("fields.teachingLanguagesHint")}
        >
          {(field) => <LanguagePicker {...field} />}
        </FormField>
        <TextField<InstructorFormValues>
          name="website"
          label={t("fields.website")}
          description={t("fields.websiteHint")}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://"
          dir="ltr"
          maxLength={300}
        />
      </FormSection>

      {!instructor && (
        <FormSection title={t("form.inviteTitle")} description={t("form.inviteDescription")}>
          <FormField<InstructorFormValues>
            name="inviteLocale"
            label={t("fields.inviteLocale")}
            description={t("fields.inviteLocaleHint")}
          >
            {({ value, onChange, onBlur, ref, id, ...aria }) => (
              <ToggleGroup
                ref={ref}
                id={id}
                type="single"
                variant="outline"
                value={(value as InviteLocale | undefined) ?? ""}
                onValueChange={(next) => next && onChange(next)}
                onBlur={onBlur}
                className="flex-wrap"
                // A <label for> cannot name this group (a div), so it carries the label's text itself.
                aria-label={t("fields.inviteLocale")}
                aria-describedby={aria["aria-describedby"]}
                aria-invalid={aria["aria-invalid"]}
              >
                {inviteLocales.map((l) => (
                  <ToggleGroupItem key={l} value={l} lang={l} className="h-9 px-4">
                    {tc(`locales.${l}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </FormField>
        </FormSection>
      )}

      <FormActions>
        <Button variant="ghost" size="lg" asChild>
          <Link href={instructor ? `/admin/instructors/${instructor.id}` : "/admin/instructors"}>
            {tc("actions.cancel")}
          </Link>
        </Button>
        <SubmitButton pending={pending}>{instructor ? tc("actions.saveChanges") : t("create")}</SubmitButton>
      </FormActions>
    </Form>
  )
}

