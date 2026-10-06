import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { PageHeader } from "@/components/admin/page-header"
import { getInstructor } from "@/features/instructors/queries"
import { profileText } from "@/features/instructors/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { InstructorForm } from "../../_components/instructor-form"

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/instructors/[id]/edit">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [instructor, locale, t] = await Promise.all([getInstructor(id), getLocale(), getTranslations("instructors")])
  return instructor ? { title: t("editTitle", { name: profileText(instructor.displayName, locale) }) } : {}
}

export default async function EditInstructorPage({ params }: PageProps<"/[locale]/admin/instructors/[id]/edit">) {
  await requireAdmin()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const [instructor, t, locale] = await Promise.all([getInstructor(id), getTranslations("instructors"), getLocale()])
  if (!instructor) notFound()

  return (
    <>
      <PageHeader
        title={t("editTitle", { name: profileText(instructor.displayName, locale) })}
        description={t("editDescription")}
        back={{ href: `/admin/instructors/${id}`, label: t("backToProfile") }}
      />
      <InstructorForm
        instructor={{
          id: instructor.id,
          displayName: instructor.displayName,
          teachingField: instructor.teachingField,
          officialName: instructor.officialName,
          idNumberMasked: instructor.idNumberMasked,
          mobile: instructor.mobile,
          email: instructor.email,
          bio: instructor.bio,
          teachingLanguages: instructor.teachingLanguages,
          website: instructor.website,
          photoPath: instructor.photoPath,
          photoUrl: instructor.photoUrl,
        }}
      />
    </>
  )
}
