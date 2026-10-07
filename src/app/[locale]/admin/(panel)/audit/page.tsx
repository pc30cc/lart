import { ActivityIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { DataTable, type Column } from "@/components/admin/data-table/data-table"
import { parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { PageHeader } from "@/components/admin/page-header"
import { emailTemplateNames } from "@/emails/names"
import { getAuditFilterOptions, listAudit, auditTable, type AuditRow } from "@/features/audit/queries"
import { parseDateRange } from "@/features/audit/range"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { AuditData } from "./_components/audit-data"
import { DateRangeFilter } from "./_components/date-range-filter"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.audit")
  return { title: t("title") }
}

const isUuid = (v: string) => z.uuid().safeParse(v).success

/** Where an entry's record can be opened, when the panel has a page for it. */
function recordHref(entity: string, id: string | null): string | null {
  if (!id) return null
  if (entity === "setting") return id === "cdn" ? "/admin/settings/storage" : id === "watermark" ? "/admin/settings/watermark" : "/admin/settings"
  if (entity === "email") return (emailTemplateNames as readonly string[]).includes(id) ? `/admin/templates/emails/${id}` : null
  if (entity === "admin_invite") return "/admin/money/partners"
  const base = { category: "categories", workshop: "workshops", instructor: "instructors", template: "templates" }[entity]
  return base && isUuid(id) ? `/admin/${base}/${id}` : null
}

export default async function AuditPage({ searchParams }: PageProps<"/[locale]/admin/audit">) {
  await requireAdmin()
  const sp = await searchParams
  const [t, locale, options] = await Promise.all([getTranslations("settings.audit"), getLocale(), getAuditFilterOptions()])
  const params = parseTableParams(sp, {
    sort: auditTable.sort,
    defaultSort: "at",
    defaultDir: "desc",
    pageSize: 25,
    filters: { admin: options.admins.map((a) => a.id), entity: options.entities },
  })
  const range = parseDateRange(sp)
  const { rows, total } = await listAudit(params, range, locale)

  /** A translated label when there is one, the code otherwise (modules add new actions over time). */
  const label = (key: string, fallback: string) => {
    const raw = t.has(key) ? t.raw(key) : null
    return typeof raw === "string" ? t(key) : fallback
  }
  const entityLabel = (entity: string) => label(`entities.${entity}`, entity)

  const columns: Column<AuditRow>[] = [
    {
      key: "at",
      header: t("table.when"),
      sortable: true,
      cell: (row) => (
        <time
          dateTime={row.at.toISOString()}
          title={formatDateTime(row.at, locale, "full")}
          className="text-sm whitespace-nowrap tabular-nums"
        >
          {formatDateTime(row.at, locale, "medium")}
        </time>
      ),
    },
    {
      key: "admin",
      header: t("table.who"),
      cell: (row) =>
        row.adminName ? (
          <span className="font-medium whitespace-nowrap">{row.adminName}</span>
        ) : (
          <span className="text-muted-foreground">{t("system")}</span>
        ),
    },
    {
      key: "action",
      header: t("table.what"),
      sortable: true,
      // On phones (no details column) this takes the room left and truncates, like a primary column.
      className: "max-sm:w-full max-sm:max-w-0",
      cell: (row) => {
        const text = label(`actions.${row.action}`, row.action)
        return (
          <span className="block min-w-0" title={text}>
            <span className="block truncate">{text}</span>
            <code dir="ltr" className="text-muted-foreground block truncate font-mono text-[0.7rem]">
              {row.action}
            </code>
          </span>
        )
      },
    },
    {
      key: "entity",
      header: t("table.record"),
      sortable: true,
      hideBelow: "md",
      cell: (row) => {
        const href = recordHref(row.entity, row.entityId)
        // Short and distinctive: a uuid's first 8 characters, a storage path's file name. The title has all of it.
        const id = row.entityId && (isUuid(row.entityId) ? row.entityId.slice(0, 8) : row.entityId.split("/").pop() || row.entityId)
        const idClass = "block w-fit max-w-40 truncate font-mono text-[0.7rem]"
        return (
          <span className="block min-w-0">
            <span className="block whitespace-nowrap">{entityLabel(row.entity)}</span>
            {id &&
              (href ? (
                <Link href={href} title={row.entityId ?? undefined} className={cn(idClass, "text-primary hover:underline")} dir="ltr">
                  {id}
                </Link>
              ) : (
                <code dir="ltr" title={row.entityId ?? undefined} className={cn(idClass, "text-muted-foreground")}>
                  {id}
                </code>
              ))}
          </span>
        )
      },
    },
    {
      key: "data",
      header: t("table.details"),
      hideBelow: "sm",
      // Takes the width left over and truncates, so the table fits its card and the IP stays in view.
      primary: true,
      cell: (row) => <AuditData summary={row.summary} detail={row.detail} />,
    },
    {
      key: "ip",
      header: t("table.ip"),
      hideBelow: "lg",
      align: "end",
      cell: (row) => (
        <code dir="ltr" className="text-muted-foreground font-mono text-xs">
          {row.ip ?? "—"}
        </code>
      ),
    },
  ]

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={<DateRangeFilter {...range} />} />
      <DataTable
        columns={columns}
        rows={rows}
        total={total}
        // The date range counts as a filter: with it, "nothing found" is shown instead of the empty log.
        params={{ ...params, filters: { ...params.filters, ...range } }}
        rowKey={(row) => row.id}
        searchPlaceholder={t("table.search")}
        filters={[
          { key: "admin", label: t("table.who"), options: options.admins.map((a) => ({ value: a.id, label: a.name })) },
          {
            key: "entity",
            label: t("table.record"),
            options: options.entities.map((e) => ({ value: e, label: entityLabel(e) })),
          },
        ]}
        empty={<EmptyState icon={ActivityIcon} title={t("empty.title")} description={t("empty.description")} />}
      />
    </>
  )
}
