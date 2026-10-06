import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { PageHeader } from "@/components/admin/page-header"
import { getCategory } from "@/features/categories/queries"
import { requireAdmin } from "@/lib/auth/admin"
import { localized } from "@/lib/format"
import { CategoryForm } from "../_components/category-form"
import { DeleteCategory } from "../_components/delete-category"

async function load(id: string) {
  if (!z.uuid().safeParse(id).success) notFound()
  const category = await getCategory(id)
  if (!category) notFound()
  return category
}

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/categories/[id]">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [category, locale] = await Promise.all([getCategory(id), getLocale()])
  return category ? { title: localized(category.name, locale) } : {}
}

export default async function EditCategoryPage({ params }: PageProps<"/[locale]/admin/categories/[id]">) {
  await requireAdmin()
  const { id } = await params
  const [category, t, locale] = await Promise.all([load(id), getTranslations("categories"), getLocale()])
  const name = localized(category.name, locale)

  return (
    <>
      <PageHeader
        title={name}
        description={t("editDescription")}
        back={{ href: "/admin/categories", label: t("backToList") }}
      />
      <div className="space-y-10">
        <CategoryForm category={{ id: category.id, name: category.name, slug: category.slug, sort: category.sort }} />
        <DeleteCategory id={category.id} name={name} workshops={category.workshops} />
      </div>
    </>
  )
}
