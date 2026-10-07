"use client"

import { LockIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { Form, FormField, TextField } from "@/components/admin/form/form"
import { LocalizedInput, LocalizedTextarea } from "@/components/admin/form/localized-input"
import { LanguagePicker } from "@/components/language-picker"
import { Checkbox } from "@/components/ui/checkbox"
import { instructorSignupAction } from "@/features/accounts/actions"
import { instructorSignupSchema, type InstructorSignupValues } from "@/features/accounts/schema"
import { cn } from "@/lib/utils"
import { BigSubmit, BigTextField, EmailField, FormAlert, PasswordField } from "./fields"
import { useSiteForm } from "./use-site-form"

/** Big, phone-friendly controls, as on the instructor's profile page. */
const big = "[&_input]:h-12 [&_input]:text-base [&_textarea]:text-base [&_label]:text-base [&_[data-slot=tabs-list]]:h-10!"

/**
 * An instructor's own sign-up: the public profile, the private details the
 * contracts need, then email and password. The action signs the new
 * instructor in and opens the panel (waiting for the team's approval).
 */
export function InstructorSignupForm({ minLength }: { minLength: number }) {
  const t = useTranslations("auth.instructor.signup")
  const ta = useTranslations("account")
  const { form, submit, pending, error } = useSiteForm({
    schema: instructorSignupSchema,
    action: instructorSignupAction,
    defaultValues: {
      displayName: { fa: "", tr: "", en: "" },
      teachingField: { fa: "", tr: "", en: "" },
      bio: { fa: "", tr: "", en: "" },
      teachingLanguages: [],
      website: "",
      officialName: "",
      idNumber: "",
      mobile: "",
      email: "",
      password: "",
      agree: false as unknown as true,
    },
  })

  return (
    <Form form={form} onSubmit={submit} className="space-y-10">
      <Part title={t("public.title")} description={t("public.description")}>
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
        <LocalizedTextarea
          name="bio"
          label={t("fields.bio")}
          description={t("fields.bioHint")}
          maxLength={600}
          rows={4}
          className={big}
        />
        <FormField<InstructorSignupValues>
          name="teachingLanguages"
          label={t("fields.teachingLanguages")}
          description={t("fields.teachingLanguagesHint")}
          className="[&_[role=combobox]]:h-12 [&_[role=combobox]]:text-base"
        >
          {(field) => <LanguagePicker {...field} />}
        </FormField>
        <TextField<InstructorSignupValues>
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
      </Part>

      <Part
        title={t("private.title")}
        description={
          <span className="flex gap-2">
            <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t("private.description")}
          </span>
        }
      >
        <BigTextField
          name="officialName"
          label={t("fields.officialName")}
          description={t("fields.officialNameHint")}
          required
          autoComplete="name"
          maxLength={120}
        />
        <BigTextField
          name="idNumber"
          label={t("fields.idNumber")}
          description={t("fields.idNumberHint")}
          required
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          maxLength={32}
          className="[&_input]:font-mono [&_input]:tracking-wide"
        />
        <BigTextField
          name="mobile"
          label={t("fields.mobile")}
          description={t("fields.mobileHint")}
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+90 5__ ___ __ __"
          dir="ltr"
          maxLength={24}
        />
      </Part>

      <Part title={t("account.title")} description={t("account.description")}>
        <EmailField label={ta("form.email")} />
        <PasswordField
          label={ta("form.password")}
          description={ta("form.newPasswordHint", { min: minLength })}
          autoComplete="new-password"
        />
        <FormField<InstructorSignupValues> name="agree">
          {({ value, onChange, id, ref, ...field }) => (
            <label
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3.5 rounded-xl border p-4 transition-colors",
                value ? "border-primary/50 bg-primary/5" : "hover:bg-muted/50",
                field["aria-invalid"] && "border-destructive/60",
              )}
            >
              <Checkbox
                id={id}
                ref={ref}
                checked={value === true}
                onCheckedChange={(checked) => onChange(checked === true)}
                aria-invalid={field["aria-invalid"]}
                aria-describedby={field["aria-describedby"]}
                className="border-foreground/50 mt-0.5 size-5 rounded-[5px] border-2 [&_svg]:size-4!"
              />
              <span className="text-base leading-snug">{t("agree")}</span>
            </label>
          )}
        </FormField>
      </Part>

      {error && <FormAlert>{error}</FormAlert>}
      <BigSubmit pending={pending}>{t("submit")}</BigSubmit>
    </Form>
  )
}

function Part({ title, description, children }: { title: string; description: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="space-y-1 border-b pb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm text-pretty">{description}</p>
      </div>
      {children}
    </section>
  )
}
