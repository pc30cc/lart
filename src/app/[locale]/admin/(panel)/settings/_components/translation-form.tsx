"use client"

import { CircleCheckIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"

import { Form, FormActions, FormField, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { saveTranslationSettings } from "@/features/translate/actions"
import { translationModels, translationSettingsSchema, type TranslationSettingsValues } from "@/features/translate/schema"
import { ChoiceCards } from "./fields"

/** Message keys of the models (a key can't hold the "." of "gpt-4.1"). */
const modelKeys = { "gpt-4o-mini": "gpt4oMini", "gpt-4.1-mini": "gpt41Mini", "gpt-4.1-nano": "gpt41Nano" } as const

/**
 * Automatic translation (the "Translate" button by every field in three
 * languages): an OpenAI API key, never shown again once saved (empty keeps
 * it), and a cheap model. Without a key a free service is used.
 */
export function TranslationSettingsForm({ saved }: { saved: { keySaved: boolean; model: (typeof translationModels)[number] } }) {
  const t = useTranslations("settings.translation")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const [keySaved, setKeySaved] = useState(saved.keySaved)
  const { form, submit, pending } = useActionForm({
    schema: translationSettingsSchema,
    action: saveTranslationSettings,
    defaultValues: { openaiKey: "", removeKey: false, model: saved.model },
    successMessage: ts("toast.saved"),
    onSuccess: (data) => {
      setKeySaved(data.keySaved)
      form.reset({ ...form.getValues(), openaiKey: "", removeKey: false })
    },
  })

  function removeKey() {
    form.setValue("removeKey", true, { shouldDirty: true })
    void submit()
  }

  return (
    <Form form={form} onSubmit={submit} className="mt-10">
      <FormSection title={t("title")} description={t("description")}>
        <TextField<TranslationSettingsValues>
          name="openaiKey"
          label={t("key")}
          description={
            keySaved ? (
              <span className="text-success inline-flex items-center gap-1.5">
                <CircleCheckIcon className="size-4" aria-hidden />
                {t("keySaved")}
              </span>
            ) : (
              t("keyHint")
            )
          }
          type="password"
          autoComplete="off"
          dir="ltr"
          placeholder={keySaved ? "••••••••••" : "sk-…"}
          maxLength={300}
        />
        <FormField<TranslationSettingsValues> name="model" label={t("model")} description={t("modelHint")}>
          {(field) => (
            <ChoiceCards
              id={field.id}
              value={field.value as (typeof translationModels)[number]}
              onChange={field.onChange}
              describedBy={field["aria-describedby"]}
              choices={translationModels.map((m) => ({ value: m, title: m, description: t(`models.${modelKeys[m]}`), lang: "en" }))}
            />
          )}
        </FormField>
      </FormSection>
      <FormActions>
        {keySaved && (
          <Button type="button" variant="outline" size="lg" className="px-4" onClick={removeKey} disabled={pending}>
            {t("removeKey")}
          </Button>
        )}
        <SubmitButton pending={pending} disabled={!form.formState.isDirty}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}
