import { PlusIcon, TagsIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { DataTable, type Column } from "@/components/admin/data-table/data-table"
import { parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge } from "@/components/admin/status-badge"
import { Button } from "@/components/ui/button"
import { listCategories, type CategoryRow } from "@/features/categories/queries"
import { categoryTable } from "@/features/categories/schema"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatNumber, localized } from "@/lib/format"
import { CategoryRowActions } from "./_components/row-actions"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("categories")
  return { title: t("title") }
}

export default async function CategoriesPage({ searchParams }: PageProps<"/[locale]/admin/categories">) {
  await requireAdmin()
  const [t, locale] = await Promise.all([getTranslations("categories"), getLocale()])
  const params = parseTableParams(await searchParams, {
    sort: categoryTable.sort,
    defaultSort: "sort",
    filters: categoryTable.filters,
  })
  const { rows, total } = await listCategories(params, locale)

  const newButton = (
    <Button asChild size="lg" className="px-4">
      <Link href="/admin/categories/new">
        <PlusIcon />
        {t("new")}
      </Link>
    </Button>
  )

  const columns: Column<CategoryRow>[] = [
    {
      key: "name",
      header: t("table.name"),
      sortable: true,
      primary: true,
      cell: (row) => {
        const others = (["fa", "tr", "en"] as const)
          .filter((l) => l !== locale && row.name[l])
          .map((l) => row.name[l])
        return (
          <Link href={`/admin/categories/${row.id}`} className="group/name block min-w-0">
            <span className="group-hover/name:text-primary block truncate font-medium transition-colors">
              {localized(row.name, locale)}
            </span>
            {others.length > 0 && (
              <span className="text-muted-foreground block truncate text-xs">{others.join(" · ")}</span>
            )}
          </Link>
        )
      },
    },
    {
      key: "slug",
      header: t("table.slug"),
      hideBelow: "md",
      cell: (row) => (
        <code dir="ltr" className="text-muted-foreground bg-muted rounded-md px-1.5 py-0.5 font-mono text-xs">
          {row.slug}
        </code>
      ),
    },
    {
      key: "workshops",
      header: t("table.workshops"),
      sortable: true,
      cell: (row) =>
        row.workshops > 0 ? (
          <StatusBadge tone="success">{t("table.usedCount", { count: row.workshops })}</StatusBadge>
        ) : (
          <StatusBadge>{t("table.unused")}</StatusBadge>
        ),
    },
    {
      key: "sort",
      header: t("table.sort"),
      sortable: true,
      align: "end",
      hideBelow: "sm",
      cell: (row) => <span className="text-muted-foreground tabular-nums">{formatNumber(row.sort, locale)}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("table.actions")}</span>,
      align: "end",
      className: "w-12",
      cell: (row) => (
        <CategoryRowActions id={row.id} name={localized(row.name, locale)} workshops={row.workshops} />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        // With no categories at all, the empty state carries the button instead.
        actions={total > 0 || params.q || Object.keys(params.filters).length ? newButton : undefined}
      />
      <DataTable
        columns={columns}
        rows={rows}
        total={total}
        params={params}
        rowKey={(row) => row.id}
        searchPlaceholder={t("table.searchPlaceholder")}
        filters={[
          {
            key: "usage",
            label: t("table.usage"),
            options: [
              { value: "used", label: t("table.used") },
              { value: "unused", label: t("table.unused") },
            ],
          },
        ]}
        empty={
          <EmptyState icon={TagsIcon} title={t("empty.title")} description={t("empty.description")} action={newButton} />
        }
      />
    </>
  )
}
