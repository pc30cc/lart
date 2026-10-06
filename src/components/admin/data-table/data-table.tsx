import { SearchXIcon } from "lucide-react"
import { getLocale, getTranslations } from "next-intl/server"

import {
  ClearFilters,
  DataTablePagination,
  DataTableRoot,
  DataTableToolbar,
  SortButton,
  type FilterDef,
} from "@/components/admin/data-table/client"
import type { TableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

export type Column<Row> = {
  /** Also the sort key when `sortable`. */
  key: string
  header: React.ReactNode
  cell: (row: Row) => React.ReactNode
  sortable?: boolean
  align?: "start" | "end" | "center"
  /** Hide on small screens to keep the table readable on phones. */
  hideBelow?: "sm" | "md" | "lg"
  className?: string
}

const alignClass = { start: "text-start", end: "text-end", center: "text-center" }
const hideClass = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" }

/**
 * Server-rendered table driven by URL params (see `parseTableParams`):
 * search, filters, sorting and pagination survive reloads and can be shared.
 * Pass the rows of the current page and the total count from your query.
 */
export async function DataTable<Row>({
  columns,
  rows,
  total,
  params,
  rowKey,
  searchPlaceholder,
  filters,
  empty,
  className,
}: {
  columns: Column<Row>[]
  rows: Row[]
  total: number
  params: TableParams<string, string>
  rowKey: (row: Row) => string
  searchPlaceholder?: string
  filters?: FilterDef[]
  /** Shown when there is no data at all (no search or filter active). Usually an <EmptyState>. */
  empty?: React.ReactNode
  className?: string
}) {
  const t = await getTranslations("common.table")
  const locale = await getLocale()
  const filtered = Boolean(params.q) || Object.keys(params.filters).length > 0

  if (total === 0 && !filtered && empty) return <>{empty}</>

  const pages = Math.max(1, Math.ceil(total / params.pageSize))
  const from = rows.length ? params.offset + 1 : 0
  const to = rows.length ? params.offset + rows.length : 0
  const n = (v: number) => formatNumber(v, locale)

  return (
    <DataTableRoot>
      <DataTableToolbar
        q={params.q}
        searchPlaceholder={searchPlaceholder}
        filters={filters}
        values={params.filters as Record<string, string | undefined>}
      />
      <div className={cn("bg-card ring-foreground/8 overflow-hidden rounded-xl shadow-xs ring-1", className)}>
        {rows.length === 0 ? (
          <EmptyState
            icon={SearchXIcon}
            title={t("noResults")}
            description={t("noResultsHint")}
            action={<ClearFilters keys={["q", "page", ...(filters ?? []).map((f) => f.key)]} />}
            className="rounded-none border-0 bg-transparent"
          />
        ) : (
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    aria-sort={
                      col.sortable && params.sort === col.key
                        ? params.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={cn(
                      "text-muted-foreground h-11 px-4 text-xs font-medium",
                      alignClass[col.align ?? "start"],
                      col.hideBelow && hideClass[col.hideBelow],
                      col.className,
                    )}
                  >
                    {col.sortable ? (
                      <SortButton column={col.key} active={params.sort === col.key} dir={params.dir}>
                        {col.header}
                      </SortButton>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={rowKey(row)} className="group/row">
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(
                        "px-4 py-3",
                        alignClass[col.align ?? "start"],
                        col.hideBelow && hideClass[col.hideBelow],
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {total > 0 && (
        <DataTablePagination
          page={params.page}
          pages={pages}
          summary={t("showing", { from: n(from), to: n(to), total: n(total) })}
        />
      )}
    </DataTableRoot>
  )
}
