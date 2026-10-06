"use client"

import { ChevronDownIcon, CornerDownRightIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Fragment, useState } from "react"

import { SortButton } from "@/components/admin/data-table/client"
import { Money } from "@/components/admin/money"
import { StatusBadge } from "@/components/admin/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Account, TransactionKind } from "@/features/money/ledger"
import { Link } from "@/i18n/navigation"
import { formatDate, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ReverseEntry } from "./reverse-entry"

export type LedgerRow = {
  id: string
  kind: TransactionKind
  originalKind: TransactionKind | null
  reversalOf: string | null
  reversedBy: string | null
  occurredOn: string
  description: string
  workshop: { id: string; title: string } | null
  createdBy: string | null
  createdAt: Date
  amount: number
  walletChange: number
  reversible: boolean
  lines: { account: Account; partnerName: string | null; amount: number }[]
}

/** The ledger: one row per transaction; open a row to see its debit and credit lines. */
export function LedgerTable({ rows, sort, dir }: { rows: LedgerRow[]; sort: "occurredOn" | "amount"; dir: "asc" | "desc" }) {
  const t = useTranslations("money")
  const locale = useLocale()
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <Table>
      <TableHeader className="bg-muted/40">
        <TableRow className="hover:bg-transparent">
          <TableHead
            aria-sort={sort === "occurredOn" ? (dir === "asc" ? "ascending" : "descending") : undefined}
            className="text-muted-foreground h-11 w-32 px-4 text-start text-xs font-medium"
          >
            <SortButton column="occurredOn" active={sort === "occurredOn"} dir={dir}>
              {t("columns.date")}
            </SortButton>
          </TableHead>
          <TableHead className="text-muted-foreground h-11 w-full px-4 text-start text-xs font-medium">{t("columns.entry")}</TableHead>
          <TableHead className="text-muted-foreground hidden h-11 px-4 text-start text-xs font-medium md:table-cell">
            {t("columns.workshop")}
          </TableHead>
          <TableHead
            aria-sort={sort === "amount" ? (dir === "asc" ? "ascending" : "descending") : undefined}
            className="text-muted-foreground h-11 px-4 text-end text-xs font-medium"
          >
            <SortButton column="amount" active={sort === "amount"} dir={dir}>
              {t("columns.amount")}
            </SortButton>
          </TableHead>
          <TableHead className="w-10 px-2">
            <span className="sr-only">{t("ledger.details")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const expanded = open.has(row.id)
          const label = row.originalKind
            ? t("kinds.reversalOf", { kind: t(`kinds.${row.originalKind}`) })
            : t(`kinds.${row.kind}`)
          return (
            <Fragment key={row.id}>
              <TableRow
                className={cn("group/row cursor-pointer", expanded && "bg-muted/30 hover:bg-muted/30", row.reversedBy && "opacity-60")}
                onClick={() => toggle(row.id)}
              >
                <TableCell className="px-4 py-3 align-top whitespace-nowrap tabular-nums">
                  {formatDate(`${row.occurredOn}T09:00:00Z`, locale, "medium")}
                </TableCell>
                <TableCell className="w-full max-w-0 px-4 py-3 align-top">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn("font-medium", row.reversedBy && "line-through decoration-1")}>{label}</span>
                    {row.reversedBy && <StatusBadge>{t("ledger.reversed")}</StatusBadge>}
                    {row.reversalOf && <StatusBadge tone="warning">{t("ledger.correction")}</StatusBadge>}
                  </div>
                  {row.description && (
                    // dir="auto": a Latin description in Persian (or the other way round) is cut at its own end.
                    <p dir="auto" title={row.description} className="text-muted-foreground truncate text-sm rtl:text-right">
                      {row.description}
                    </p>
                  )}
                  {row.workshop && (
                    <p dir="auto" className="text-muted-foreground truncate text-xs md:hidden rtl:text-right">
                      {row.workshop.title}
                    </p>
                  )}
                </TableCell>
                <TableCell
                  dir="auto"
                  title={row.workshop?.title}
                  className="text-muted-foreground hidden max-w-56 truncate px-4 py-3 align-top text-sm md:table-cell rtl:text-right"
                >
                  {row.workshop?.title ?? "—"}
                </TableCell>
                <TableCell className="px-4 py-3 text-end align-top">
                  {row.walletChange !== 0 ? (
                    <Money value={row.walletChange} tone="signed" className="font-medium" />
                  ) : (
                    <Money value={row.amount} className="font-medium" />
                  )}
                  {row.walletChange !== 0 && (
                    <span className="text-muted-foreground block text-xs">{t("ledger.wallet")}</span>
                  )}
                </TableCell>
                <TableCell className="px-2 py-3 align-top">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`lines-${row.id}`}
                    aria-label={t("ledger.details")}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(row.id)
                    }}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-7 items-center justify-center rounded-md transition-colors"
                  >
                    <ChevronDownIcon className={cn("size-4 transition-transform duration-200", expanded && "rotate-180")} />
                  </button>
                </TableCell>
              </TableRow>
              {expanded && (
                <TableRow id={`lines-${row.id}`} className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={5} className="px-4 pt-0 pb-4">
                    <EntryLines row={row} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}

function EntryLines({ row }: { row: LedgerRow }) {
  const t = useTranslations("money")
  const locale = useLocale()
  return (
    <div className="animate-in fade-in-0 slide-in-from-top-1 space-y-3 duration-200">
      <div className="bg-card ring-foreground/8 overflow-x-auto rounded-lg ring-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-xs">
              <th className="px-3 py-2 text-start font-medium">{t("columns.account")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("columns.debit")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("columns.credit")}</th>
            </tr>
          </thead>
          <tbody>
            {row.lines.map((line, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <span className={cn("inline-flex items-center gap-1.5", line.amount < 0 && "ps-4")}>
                    {line.amount < 0 && <CornerDownRightIcon className="text-muted-foreground size-3.5 rtl:-scale-x-100" />}
                    {t(`accounts.${line.account}`)}
                    {line.partnerName && <span className="text-muted-foreground">· {line.partnerName}</span>}
                  </span>
                </td>
                <td className="px-3 py-2 text-end">{line.amount > 0 && <Money value={line.amount} />}</td>
                <td className="px-3 py-2 text-end">{line.amount < 0 && <Money value={-line.amount} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {row.createdBy
            ? t("ledger.recordedBy", { name: row.createdBy, date: formatDateTime(row.createdAt, locale, "medium") })
            : t("ledger.recordedAuto", { date: formatDateTime(row.createdAt, locale, "medium") })}
          {row.workshop && (
            <>
              {" · "}
              <Link href={`/admin/workshops/${row.workshop.id}/finances`} className="hover:text-foreground underline underline-offset-3">
                {t("ledger.openWorkshop")}
              </Link>
            </>
          )}
        </p>
        {row.reversible && <ReverseEntry id={row.id} what={row.description || t(`kinds.${row.kind}`)} />}
      </div>
    </div>
  )
}
