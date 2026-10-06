import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { PageHeader } from "@/components/admin/page-header"
import { templateKinds } from "@/features/templates/placeholders"
import { templatePreview } from "@/features/templates/preview"
import { getTemplate } from "@/features/templates/queries"
import { requireAdmin } from "@/lib/auth/admin"
import { TemplateForm } from "../_components/template-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("templates")
  return { title: t("newTitle") }
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** ?kind=terms|contract preselects the kind; ?from=<id> starts from a copy of that template. */
export default async function NewTemplatePage({ searchParams }: PageProps<"/[locale]/admin/templates/new">) {
  await requireAdmin()
  const sp = await searchParams
  const fromId = z.uuid().safeParse(first(sp.from))
  const kindParam = z.enum(templateKinds).safeParse(first(sp.kind))
  const [t, preview, source] = await Promise.all([
    getTranslations("templates"),
    templatePreview(),
    fromId.success ? getTemplate(fromId.data) : null,
  ])

  const initial = source
    ? { kind: source.kind, name: t("copyName", { name: source.name }).slice(0, 120), body: source.body }
    : { kind: kindParam.success ? kindParam.data : ("terms" as const), name: "", body: {} }

  return (
    <>
      <PageHeader
        title={source ? t("copyTitle") : t("newTitle")}
        description={source ? t("copyDescription", { name: source.name }) : t("newDescription")}
        back={{ href: "/admin/templates", label: t("backToList") }}
      />
      <TemplateForm initial={initial} preview={preview} />
    </>
  )
}
