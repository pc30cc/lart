import { RotateCcwIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge } from "@/components/admin/status-badge"
import { Button } from "@/components/ui/button"
import { resetEmailTexts } from "@/features/templates/actions"
import { getEmailEditor, isEmailTemplate } from "@/features/templates/emails"
import { requireAdmin } from "@/lib/auth/admin"
import { EmailTextsForm } from "../../_components/email-form"

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/templates/emails/[name]">): Promise<Metadata> {
  const { name } = await params
  if (!isEmailTemplate(name)) return {}
  const t = await getTranslations("templates.emails")
  return { title: t(`names.${name}.title`) }
}

export default async function EmailTextsPage({ params }: PageProps<"/[locale]/admin/templates/emails/[name]">) {
  await requireAdmin()
  const { name } = await params
  if (!isEmailTemplate(name)) notFound()
  const [t, tc, editor] = await Promise.all([getTranslations("templates"), getTranslations("common"), getEmailEditor(name)])

  return (
    <>
      <PageHeader
        title={t(`emails.names.${name}.title`)}
        back={{ href: "/admin/templates", label: t("backToList") }}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span>{t("emails.to", { who: t(`emails.names.${name}.to`) })}</span>
            {editor.edited.length > 0 ? (
              <StatusBadge tone="brand">
                {t("emails.edited")} · {editor.edited.map((l) => tc(`locales.${l}`)).join(", ")}
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral">{t("emails.defaultTexts")}</StatusBadge>
            )}
          </span>
        }
        actions={
          editor.edited.length > 0 && (
            <ConfirmAction
              action={resetEmailTexts}
              input={{ template: name }}
              title={t("emails.reset.title")}
              description={t("emails.reset.description")}
              confirmLabel={t("emails.reset.confirm")}
              successMessage={t("emails.toast.reset")}
              trigger={
                <Button variant="outline" size="lg" className="px-4">
                  <RotateCcwIcon />
                  {t("emails.reset.action")}
                </Button>
              }
            />
          )
        }
      />
      {/* Remounts after a reset or save elsewhere, so the fields show what is stored. */}
      <EmailTextsForm key={JSON.stringify(editor.saved)} editor={editor} />
    </>
  )
}
