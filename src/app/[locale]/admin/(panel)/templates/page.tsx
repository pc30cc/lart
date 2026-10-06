import { CheckIcon, FileSignatureIcon, PlusIcon, ScrollTextIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge } from "@/components/admin/status-badge"
import { Button } from "@/components/ui/button"
import { templateKinds, type TemplateKind } from "@/features/templates/placeholders"
import { isUsed, listTemplates, type TemplateRow } from "@/features/templates/queries"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { TemplateMenu } from "./_components/template-actions"
import { usageText } from "./_components/usage"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("templates")
  return { title: t("title") }
}

const kindIcons = { terms: ScrollTextIcon, contract: FileSignatureIcon } satisfies Record<TemplateKind, unknown>

export default async function TemplatesPage() {
  await requireAdmin()
  const [t, rows] = await Promise.all([getTranslations("templates"), listTemplates()])

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-12">
        {templateKinds.map((kind) => (
          <KindSection key={kind} kind={kind} rows={rows.filter((row) => row.kind === kind)} />
        ))}
      </div>
    </>
  )
}

async function KindSection({ kind, rows }: { kind: TemplateKind; rows: TemplateRow[] }) {
  const t = await getTranslations("templates")
  const Icon = kindIcons[kind]
  const newHref = `/admin/templates/new?kind=${kind}`

  return (
    <section aria-labelledby={`kind-${kind}`} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
            <Icon className="size-[1.1rem]" />
          </span>
          <div className="space-y-0.5">
            <h2 id={`kind-${kind}`} className="text-base font-semibold">
              {t(`kinds.${kind}.plural`)}
            </h2>
            <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{t(`kinds.${kind}.description`)}</p>
          </div>
        </div>
        {rows.length > 0 && (
          <Button asChild variant="outline" size="lg" className="shrink-0 self-start px-3.5 sm:self-auto">
            <Link href={newHref}>
              <PlusIcon />
              {t(`kinds.${kind}.new`)}
            </Link>
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Icon}
          title={t(`kinds.${kind}.emptyTitle`)}
          description={t(`kinds.${kind}.emptyDescription`)}
          action={
            <Button asChild size="lg" className="px-4">
              <Link href={newHref}>
                <PlusIcon />
                {t(`kinds.${kind}.new`)}
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((row) => (
            <TemplateCard key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}

async function TemplateCard({ row }: { row: TemplateRow }) {
  const [t, tc, locale] = await Promise.all([getTranslations("templates"), getTranslations("common"), getLocale()])

  return (
    <li
      className={cn(
        "group bg-card relative flex flex-col gap-4 rounded-xl p-4 shadow-xs ring-1 transition-all hover:shadow-md md:p-5",
        row.isDefault ? "ring-primary/25" : "ring-foreground/8 hover:ring-foreground/15",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/templates/${row.id}`}
              className="group-hover:text-primary font-medium transition-colors after:absolute after:inset-0 after:rounded-xl"
            >
              {row.name}
            </Link>
            {row.isDefault && <StatusBadge tone="brand">{t("default")}</StatusBadge>}
          </div>
          <p className="text-muted-foreground text-sm text-pretty">{usageText(t, row.kind, row.isDefault, row.usage)}</p>
        </div>
        <div className="relative z-10 -me-1.5 -mt-1">
          <TemplateMenu
            template={{ id: row.id, name: row.name, kind: row.kind, isDefault: row.isDefault, used: isUsed(row.usage) }}
          />
        </div>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        <ul className="flex flex-wrap items-center gap-1.5" aria-label={t("languages")}>
          {(["fa", "tr", "en"] as const).map((l) => {
            const filled = row.languages.includes(l)
            return (
              <li
                key={l}
                lang={l}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full px-2",
                  filled ? "bg-success/10 text-success" : "border-muted-foreground/40 border border-dashed",
                )}
              >
                {filled && <CheckIcon className="size-3" aria-hidden />}
                {tc(`locales.${l}`)}
                <span className="sr-only">{filled ? tc("form.filled") : tc("form.missing")}</span>
              </li>
            )
          })}
        </ul>
        <span>{t("updated", { date: formatDate(row.updatedAt, locale, "medium") })}</span>
      </div>
    </li>
  )
}
