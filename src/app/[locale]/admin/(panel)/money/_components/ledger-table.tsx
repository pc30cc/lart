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
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { EditTarget } from "@/features/money/queries"
import { DiscrepancyEntry } from "./discrepancy-entry"
import { DocumentViewer, type LedgerDocument } from "./document-viewer"
import { EditEntry } from "./edit-entry"
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
  /** "Discrepancy" offered: an entry that concerns neither a participant nor an instructor. */
  discrepancyAllowed: boolean
  /** Marked as a discrepancy: at zero, why, by whom and when. */
  discrepancy: { reason: string; by: string | null; at: Date } | null
  /** Its receipts and photos, or the transfer receipt the participant sent. */
  documents: LedgerDocument[]
  /** A registration's payment or refund: who it was for and who paid. */
  registration: { participantName: string; memberId: string; memberName: string } | null
  /** "Edit": the form's starting values, or null when it can't be edited. */
  edit: EditTarget | null
  /** An edited entry (it replaced an earlier version). */
  edited: boolean
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
                className={cn("group/row cursor-pointer", expanded && "bg-muted/30 hover:bg-muted/30", row.reversedBy && !row.discrepancy && "opacity-60")}
                onClick={() => toggle(row.id)}
              >
                <TableCell className="px-4 py-3 align-top whitespace-nowrap tabular-nums">
                  {formatDate(`${row.occurredOn}T09:00:00Z`, locale, "medium")}
                </TableCell>
                <TableCell className="w-full max-w-0 px-4 py-3 align-top">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn("font-medium", row.reversedBy && !row.discrepancy && "line-through decoration-1")}>{label}</span>
                    {row.discrepancy ? (
                      <StatusBadge tone="warning">{t("discrepancy.badge")}</StatusBadge>
                    ) : (
                      row.reversedBy && <StatusBadge>{t("ledger.reversed")}</StatusBadge>
                    )}
                    {row.reversalOf && <StatusBadge tone="warning">{t("ledger.correction")}</StatusBadge>}
                    {row.edited && <StatusBadge tone="info">{t("ledger.edited")}</StatusBadge>}
                  </div>
                  {row.description && (
                    // dir="auto": a Latin description in Persian (or the other way round) is cut at its own end.
                    <p dir="auto" title={row.description} className="text-muted-foreground truncate text-sm rtl:text-right">
                      {row.description}
                    </p>
                  )}
                  {row.registration && <Payer registration={row.registration} />}
                  {row.discrepancy && (
                    <p dir="auto" className="text-warning mt-0.5 text-sm text-pretty rtl:text-right">
                      {t("discrepancy.line", { reason: row.discrepancy.reason })}
                    </p>
                  )}
                  {row.documents.length > 0 && (
                    <div className="mt-1.5">
                      <DocumentViewer
                        documents={row.documents}
                        title={row.description ? `${label} · ${row.description}` : label}
                        details={
                          <>
                            <Money value={row.walletChange || row.amount} className="text-foreground font-medium" />
                            <span aria-hidden>·</span>
                            <span>{formatDate(`${row.occurredOn}T09:00:00Z`, locale, "long")}</span>
                            {row.registration && (
                              <>
                                <span aria-hidden>·</span>
                                <span>{t("ledger.participant", { name: row.registration.participantName })}</span>
                              </>
                            )}
                            {row.workshop && (
                              <>
                                <span aria-hidden>·</span>
                                <span dir="auto">{row.workshop.title}</span>
                              </>
                            )}
                          </>
                        }
                      />
                    </div>
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
                  {row.discrepancy ? (
                    <>
                      <Money value={0} className="font-medium" />
                      <span className="text-muted-foreground block text-xs line-through">
                        <Money value={row.walletChange || row.amount} />
                      </span>
                    </>
                  ) : row.walletChange !== 0 ? (
                    <Money value={row.walletChange} tone="signed" className="font-medium" />
                  ) : (
                    <Money value={row.amount} className="font-medium" />
                  )}
                  {row.walletChange !== 0 && !row.discrepancy && (
                    <span className="text-muted-foreground block text-xs">{t("ledger.wallet")}</span>
                  )}
                </TableCell>
                <TableCell className="px-2 py-3 align-top">
                  <span className="flex items-center gap-0.5">
                    {row.edit && <EditEntry target={row.edit} iconOnly />}
                    {row.discrepancyAllowed && <DiscrepancyEntry id={row.id} what={row.description || label} iconOnly />}
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
                  </span>
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
      {row.discrepancy && (
        <div className="border-warning/30 bg-warning/8 rounded-lg border px-3 py-2.5 text-sm">
          <p dir="auto" className="font-medium text-pretty">
            {t("discrepancy.line", { reason: row.discrepancy.reason })}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t("discrepancy.recorded", { name: row.discrepancy.by ?? "—", date: formatDateTime(row.discrepancy.at, locale, "medium") })}
            {" · "}
            {t("discrepancy.was", { amount: formatLira(Math.abs(row.walletChange || row.amount), locale) })}
          </p>
        </div>
      )}
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
        <span className="flex items-center gap-1">
          {row.edit && <EditEntry target={row.edit} />}
          {row.reversible && <ReverseEntry id={row.id} what={row.description || t(`kinds.${row.kind}`)} />}
          {row.discrepancyAllowed && <DiscrepancyEntry id={row.id} what={row.description || t(`kinds.${row.kind}`)} />}
        </span>
      </div>
      {(row.kind === "registration_payment" || row.kind === "registration_refund") && (
        <p className="text-muted-foreground text-xs text-pretty">
          {t("ledger.registrationEntry")}
          {row.workshop && (
            <>
              {" "}
              <Link
                href={`/admin/workshops/${row.workshop.id}/registrations`}
                className="hover:text-foreground underline underline-offset-3"
              >
                {t("ledger.openRegistrations")}
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  )
}

/** "Participant: Ali · Paid by Mona" (the member's page), or just the participant when they paid themselves. */
function Payer({ registration: r }: { registration: NonNullable<LedgerRow["registration"]> }) {
  const t = useTranslations("money.ledger")
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm">
      <Link
        href={`/admin/students/${r.memberId}`}
        onClick={(e) => e.stopPropagation()}
        className="text-foreground hover:text-primary font-medium underline-offset-3 hover:underline"
        dir="auto"
      >
        {t("participant", { name: r.participantName })}
      </Link>
      {r.memberName.trim() !== r.participantName.trim() && (
        <Link
          href={`/admin/students/${r.memberId}`}
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-primary text-xs underline-offset-3 hover:underline"
          dir="auto"
        >
          {t("paidBy", { name: r.memberName })}
        </Link>
      )}
    </p>
  )
}
