import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/admin/page-header"
import { requireAdmin } from "@/lib/auth/admin"
import { CategoryForm } from "../_components/category-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("categories")
  return { title: t("newTitle") }
}

export default async function NewCategoryPage() {
  await requireAdmin()
  const t = await getTranslations("categories")

  return (
    <>
      <PageHeader
        title={t("newTitle")}
        description={t("newDescription")}
        back={{ href: "/admin/categories", label: t("backToList") }}
      />
      <CategoryForm />
    </>
  )
}
