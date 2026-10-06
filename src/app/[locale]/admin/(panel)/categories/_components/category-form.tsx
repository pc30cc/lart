"use client"

import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { useWatch } from "react-hook-form"

import { Form, FormActions, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { LocalizedInput } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import type { LocalizedText } from "@/db/schema"
import { createCategory, updateCategory } from "@/features/categories/actions"
import { categorySchema, type CategoryFormValues } from "@/features/categories/schema"
import { Link, useRouter } from "@/i18n/navigation"
import { slugify } from "@/lib/format"

type Category = { id: string; name: LocalizedText; slug: string; sort: number }

/** Create (no `category`) or edit a category. */
export function CategoryForm({ category }: { category?: Category }) {
  const t = useTranslations("categories")
  const tc = useTranslations("common")
  const router = useRouter()

  const { form, submit, pending } = useActionForm({
    schema: categorySchema,
    action: (values: CategoryFormValues) =>
      category ? updateCategory({ ...values, id: category.id }) : createCategory(values),
    defaultValues: {
      name: { fa: category?.name.fa ?? "", tr: category?.name.tr ?? "", en: category?.name.en ?? "" },
      slug: category?.slug ?? "",
      sort: category?.sort ?? 0,
    },
    successMessage: category ? t("toast.updated") : t("toast.created"),
    onSuccess: () => router.push("/admin/categories"),
  })

  // The web address follows the Turkish (or English) name until it is edited by hand.
  const [slugEdited, setSlugEdited] = useState(Boolean(category))
  const [tr, en] = useWatch({ control: form.control, name: ["name.tr", "name.en"] })
  useEffect(() => {
    if (slugEdited) return
    form.setValue("slug", slugify(String(tr || en || "")), { shouldValidate: form.formState.isSubmitted })
  }, [tr, en, slugEdited, form])

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("form.nameTitle")} description={t("form.nameDescription")}>
        <LocalizedInput name="name" label={t("fields.name")} required={["fa", "tr", "en"]} maxLength={80} />
      </FormSection>

      <FormSection title={t("form.displayTitle")} description={t("form.displayDescription")}>
        <TextField<CategoryFormValues>
          name="slug"
          label={t("fields.slug")}
          description={t("fields.slugHint")}
          required
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          maxLength={80}
          className="[&_input]:font-mono [&_input]:text-sm"
          onInput={() => setSlugEdited(true)}
        />
        <TextField<CategoryFormValues>
          name="sort"
          label={t("fields.sort")}
          description={t("fields.sortHint")}
          type="number"
          inputMode="numeric"
          min={0}
          max={10000}
          dir="ltr"
          className="max-w-40"
        />
      </FormSection>

      <FormActions>
        <Button variant="ghost" size="lg" asChild>
          <Link href="/admin/categories">{tc("actions.cancel")}</Link>
        </Button>
        <SubmitButton pending={pending}>{category ? tc("actions.saveChanges") : t("create")}</SubmitButton>
      </FormActions>
    </Form>
  )
}
