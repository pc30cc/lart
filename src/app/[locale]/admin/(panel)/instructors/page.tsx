import { PlusIcon, UsersRoundIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { DataTable, type Column } from "@/components/admin/data-table/data-table"
import { parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import { listInstructors, type InstructorRow } from "@/features/instructors/queries"
import { instructorTable, languageName, profileText } from "@/features/instructors/schema"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatNumber } from "@/lib/format"
import { InstructorAvatar } from "./_components/instructor-avatar"
import { InstructorStatus } from "./_components/instructor-status"
import { InstructorRowActions } from "./_components/row-actions"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instructors")
  return { title: t("title") }
}

const SHOWN_LANGUAGES = 3

export default async function InstructorsPage({ searchParams }: PageProps<"/[locale]/admin/instructors">) {
  await requireAdmin()
  const [t, locale] = await Promise.all([getTranslations("instructors"), getLocale()])
  const params = parseTableParams(await searchParams, {
    sort: instructorTable.sort,
    defaultSort: "name",
    filters: instructorTable.filters,
  })
  const { rows, total } = await listInstructors(params, locale)

  const newButton = (
    <Button asChild size="lg" className="px-4">
      <Link href="/admin/instructors/new">
        <PlusIcon />
        {t("new")}
      </Link>
    </Button>
  )

  const columns: Column<InstructorRow>[] = [
    {
      key: "name",
      header: t("table.name"),
      sortable: true,
      cell: (row) => {
        const name = profileText(row.displayName, locale)
        return (
          <Link href={`/admin/instructors/${row.id}`} className="group/name flex min-w-0 items-center gap-3">
            <InstructorAvatar
              name={name}
              url={row.photoUrl}
              className="ring-background transition-shadow group-hover/name:ring-primary/25 ring-2"
            />
            <span className="min-w-0">
              <span className="group-hover/name:text-primary block truncate font-medium transition-colors">{name}</span>
              <span className="text-muted-foreground block max-w-64 truncate text-xs">
                <bdi>{row.email}</bdi>
              </span>
            </span>
          </Link>
        )
      },
    },
    {
      key: "teachingField",
      header: t("table.teachingField"),
      hideBelow: "md",
      cell: (row) => (
        <span className="text-muted-foreground block max-w-56 truncate">{profileText(row.teachingField, locale)}</span>
      ),
    },
    {
      key: "languages",
      header: t("table.languages"),
      hideBelow: "lg",
      cell: (row) => {
        const extra = row.teachingLanguages.length - SHOWN_LANGUAGES
        return row.teachingLanguages.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {row.teachingLanguages.slice(0, SHOWN_LANGUAGES).map((code) => (
              <span key={code} className="bg-muted rounded-md px-1.5 py-0.5 text-xs">
                {languageName(code, locale)}
              </span>
            ))}
            {extra > 0 && (
              <span className="text-muted-foreground text-xs tabular-nums">
                {t("table.moreLanguages", { count: formatNumber(extra, locale) })}
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: "status",
      header: t("table.status"),
      cell: (row) => <InstructorStatus active={row.active} hasPassword={row.hasPassword} />,
    },
    {
      key: "workshops",
      header: t("table.workshops"),
      sortable: true,
      hideBelow: "sm",
      cell: (row) => (
        <span className={row.workshops ? "tabular-nums" : "text-muted-foreground"}>
          {t("table.workshopsCount", { count: row.workshops })}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("table.actions")}</span>,
      align: "end",
      className: "w-12",
      cell: (row) => (
        <InstructorRowActions id={row.id} name={profileText(row.displayName, locale)} active={row.active} />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        // With no instructors at all, the empty state carries the button instead.
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
            key: "status",
            label: t("table.status"),
            options: instructorTable.filters.status.map((value) => ({ value, label: t(`status.${value}`) })),
          },
        ]}
        empty={
          <EmptyState
            icon={UsersRoundIcon}
            title={t("empty.title")}
            description={t("empty.description")}
            action={newButton}
          />
        }
      />
    </>
  )
}
