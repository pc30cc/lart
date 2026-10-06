import { FileSignatureIcon, ScrollTextIcon, ShieldCheckIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge } from "@/components/admin/status-badge"
import { templatePreview } from "@/features/templates/preview"
import { getTemplate } from "@/features/templates/queries"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDateTime } from "@/lib/format"
import { DeleteTemplate, MakeDefaultButton } from "../_components/template-actions"
import { TemplateForm } from "../_components/template-form"
import { deleteBlocker, usageText } from "../_components/usage"

async function load(id: string) {
  if (!z.uuid().safeParse(id).success) notFound()
  const template = await getTemplate(id)
  if (!template) notFound()
  return template
}

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/templates/[id]">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const template = await getTemplate(id)
  return template ? { title: template.name } : {}
}

export default async function EditTemplatePage({ params }: PageProps<"/[locale]/admin/templates/[id]">) {
  await requireAdmin()
  const { id } = await params
  const [tpl, t, locale, preview] = await Promise.all([
    load(id),
    getTranslations("templates"),
    getLocale(),
    templatePreview(),
  ])
  const KindIcon = tpl.kind === "contract" ? FileSignatureIcon : ScrollTextIcon

  return (
    <>
      <PageHeader
        title={tpl.name}
        back={{ href: "/admin/templates", label: t("backToList") }}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <KindIcon className="size-4 opacity-70" />
              {t(`kinds.${tpl.kind}.title`)}
            </span>
            {tpl.isDefault && <StatusBadge tone="brand">{t("default")}</StatusBadge>}
            <span className="opacity-60" aria-hidden>
              ·
            </span>
            <span>{usageText(t, tpl.kind, tpl.isDefault, tpl.usage)}</span>
            <span className="opacity-60" aria-hidden>
              ·
            </span>
            <span>{t("updated", { date: formatDateTime(tpl.updatedAt, locale, "medium") })}</span>
          </span>
        }
        actions={!tpl.isDefault && <MakeDefaultButton id={tpl.id} name={tpl.name} kind={tpl.kind} />}
      />

      <div className="space-y-10">
        <div className="border-info/25 bg-info/5 flex gap-3 rounded-xl border p-4 text-sm">
          <ShieldCheckIcon className="text-info mt-0.5 size-4 shrink-0" />
          <p className="text-pretty">{t(`notice.${tpl.kind}`)}</p>
        </div>

        <TemplateForm template={{ id: tpl.id, kind: tpl.kind, name: tpl.name, body: tpl.body }} preview={preview} />

        <DeleteTemplate id={tpl.id} name={tpl.name} reason={deleteBlocker(t, tpl.isDefault, tpl.usage)} />
      </div>
    </>
  )
}
