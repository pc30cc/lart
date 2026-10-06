import { DownloadIcon, ScrollTextIcon, SearchXIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import {
  ClearFilters,
  DataTablePagination,
  DataTableRoot,
  DataTableToolbar,
} from "@/components/admin/data-table/client"
import { parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import { getLedgerFilterOptions, isReversible, listTransactions } from "@/features/money/queries"
import { accounts, isIsoDate, transactionKinds, transactionTable } from "@/features/money/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatNumber, localized, zonedParts } from "@/lib/format"
import { LedgerTable, type LedgerRow } from "../_components/ledger-table"
import { RangeFilter } from "../_components/range-filter"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("money.ledger")
  return { title: t("title") }
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function TransactionsPage({ searchParams }: PageProps<"/[locale]/admin/money/transactions">) {
  await requireAdmin()
  const [sp, t, locale, options] = await Promise.all([
    searchParams,
    getTranslations("money"),
    getLocale(),
    getLedgerFilterOptions(),
  ])
  const params = parseTableParams(sp, {
    sort: transactionTable.sort,
    defaultSort: "occurredOn",
    defaultDir: "desc",
    pageSize: 25,
    filters: {
      ...transactionTable.filters,
      partner: options.partners.map((p) => p.id),
      workshop: options.workshops.map((w) => w.id),
    },
  })
  const [from, to] = [first(sp.from), first(sp.to)]
  const range = isIsoDate(from) && isIsoDate(to) ? (from <= to ? { from, to } : { from: to, to: from }) : {}
  const { rows, total } = await listTransactions(params, range)

  const tableRows: LedgerRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    originalKind: r.originalKind,
    reversalOf: r.reversalOf,
    reversedBy: r.reversedBy,
    occurredOn: r.occurredOn,
    description: r.description,
    workshop: r.courseId && r.courseTitle ? { id: r.courseId, title: localized(r.courseTitle, locale) } : null,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    amount: r.amount,
    walletChange: r.walletChange,
    reversible: isReversible(r),
    lines: r.lines.map((l) => ({ account: l.account, partnerName: l.partnerName, amount: l.amount })),
  }))

  const filtered = Boolean(params.q || Object.keys(params.filters).length || ("from" in range && range.from))
  const pages = Math.max(1, Math.ceil(total / params.pageSize))
  const n = (v: number) => formatNumber(v, locale)

  const exportQuery = new URLSearchParams({
    locale,
    from: "from" in range && range.from ? range.from : "2000-01-01",
    to: "to" in range && range.to ? range.to : zonedParts(new Date()).date,
    ...params.filters,
  })

  return (
    <>
      <PageHeader
        title={t("ledger.title")}
        description={t("ledger.description")}
        actions={
          total > 0 && (
            <Button asChild variant="outline" size="lg" className="px-4">
              <a href={`/api/admin/money/export/transactions?${exportQuery}`} download>
                <DownloadIcon />
                {t("reports.exportCsv")}
              </a>
            </Button>
          )
        }
      />

      {total === 0 && !filtered ? (
        <EmptyState icon={ScrollTextIcon} title={t("ledger.empty.title")} description={t("ledger.empty.description")} />
      ) : (
        <DataTableRoot>
          <DataTableToolbar
            q={params.q}
            searchPlaceholder={t("ledger.search")}
            values={params.filters}
            filters={[
              { key: "kind", label: t("columns.type"), options: transactionKinds.map((k) => ({ value: k, label: t(`kinds.${k}`) })) },
              { key: "account", label: t("columns.account"), options: accounts.map((a) => ({ value: a, label: t(`accounts.${a}`) })) },
            ]}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <DataTableToolbar
              q={params.q}
              values={params.filters}
              filters={[
                { key: "partner", label: t("columns.partner"), options: options.partners.map((p) => ({ value: p.id, label: p.name })) },
                {
                  key: "workshop",
                  label: t("columns.workshop"),
                  options: options.workshops.map((w) => ({
                    value: w.id,
                    label: `${localized(w.title, locale)} · ${formatDate(w.startsAt, locale, "short")}`,
                  })),
                },
              ]}
            />
            <RangeFilter from={"from" in range ? range.from : undefined} to={"to" in range ? range.to : undefined} clearable />
          </div>
          <div className="bg-card ring-foreground/8 overflow-hidden rounded-xl shadow-xs ring-1">
            {tableRows.length === 0 ? (
              <EmptyState
                icon={SearchXIcon}
                title={t("ledger.noResults")}
                description={t("ledger.noResultsHint")}
                action={<ClearFilters keys={["q", "page", "kind", "account", "partner", "workshop", "from", "to"]} />}
                className="rounded-none border-0 bg-transparent"
              />
            ) : (
              <LedgerTable rows={tableRows} sort={params.sort} dir={params.dir} />
            )}
          </div>
          {total > 0 && (
            <DataTablePagination
              page={params.page}
              pages={pages}
              summary={t("ledger.showing", {
                from: n(params.offset + 1),
                to: n(params.offset + rows.length),
                total: n(total),
              })}
            />
          )}
        </DataTableRoot>
      )}
    </>
  )
}
