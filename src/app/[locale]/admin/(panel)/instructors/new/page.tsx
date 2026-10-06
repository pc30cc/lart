import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/admin/page-header"
import { requireAdmin } from "@/lib/auth/admin"
import { InstructorForm } from "../_components/instructor-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instructors")
  return { title: t("newTitle") }
}

export default async function NewInstructorPage() {
  await requireAdmin()
  const t = await getTranslations("instructors")

  return (
    <>
      <PageHeader
        title={t("newTitle")}
        description={t("newDescription")}
        back={{ href: "/admin/instructors", label: t("backToList") }}
      />
      <InstructorForm />
    </>
  )
}
