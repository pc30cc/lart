import { UsersRoundIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { DataTable, type Column } from "@/components/admin/data-table/data-table"
import { parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge } from "@/components/admin/status-badge"
import { listStudents, type StudentRow } from "@/features/students/queries"
import { studentTable } from "@/features/students/schema"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatNumber } from "@/lib/format"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("students")
  return { title: t("title") }
}

export default async function StudentsPage({ searchParams }: PageProps<"/[locale]/admin/students">) {
  await requireAdmin()
  const [t, locale] = await Promise.all([getTranslations("students"), getLocale()])
  const params = parseTableParams(await searchParams, {
    sort: studentTable.sort,
    defaultSort: "createdAt",
    defaultDir: "desc",
  })
  const { rows, total } = await listStudents(params)

  const columns: Column<StudentRow>[] = [
    {
      key: "name",
      header: t("table.name"),
      sortable: true,
      primary: true,
      cell: (row) => (
        <Link href={`/admin/students/${row.id}`} className="group/name block min-w-0">
          <span className="group-hover/name:text-primary block truncate font-medium transition-colors">
            <bdi>{row.name}</bdi>
          </span>
          <span className="text-muted-foreground block max-w-72 truncate text-xs">
            <bdi dir="ltr">{row.email}</bdi>
          </span>
          {!row.emailVerified && (
            <StatusBadge tone="warning" className="mt-1">
              {t("emailNotConfirmed")}
            </StatusBadge>
          )}
        </Link>
      ),
    },
    {
      key: "phone",
      header: t("table.phone"),
      hideBelow: "md",
      cell: (row) =>
        row.phone ? (
          <bdi dir="ltr" className="tabular-nums">
            {row.phone}
          </bdi>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "registrations",
      header: t("table.registrations"),
      sortable: true,
      align: "end",
      cell: (row) => (
        <span className={row.registrations ? "tabular-nums" : "text-muted-foreground tabular-nums"}>
          {formatNumber(row.registrations, locale)}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: t("table.joined"),
      sortable: true,
      hideBelow: "sm",
      cell: (row) => <span className="text-muted-foreground whitespace-nowrap">{formatDate(row.createdAt, locale, "medium")}</span>,
    },
  ]

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <DataTable
        columns={columns}
        rows={rows}
        total={total}
        params={params}
        rowKey={(row) => row.id}
        searchPlaceholder={t("table.search")}
        empty={<EmptyState icon={UsersRoundIcon} title={t("empty.title")} description={t("empty.description")} />}
      />
    </>
  )
}
