import { HandCoinsIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { DataTable, type Column } from "@/components/admin/data-table/data-table"
import { parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge } from "@/components/admin/status-badge"
import { ChangeRefundButton, MarkRefundedButton } from "@/features/registrations/admin/components/dialogs"
import { listRefunds, refundReason, refundsOwed, type RefundRow } from "@/features/registrations/admin/queries"
import { refundTable, refundViews } from "@/features/registrations/admin/schema"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatNumber, formatPercent, localized } from "@/lib/format"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("money.refunds")
  return { title: t("title") }
}

/**
 * Refunds to pay back by hand: from members' own cancellations, an admin's,
 * and cancelled workshops. "Change refund" confirms or changes the amount
 * (e.g. in full when the date, venue or instructor changed); "Mark as
 * refunded" books it in the wallet once and tells the person. The other view lists the refunds already paid back.
 */
export default async function RefundsPage({ searchParams }: PageProps<"/[locale]/admin/money/refunds">) {
  await requireAdmin()
  const params = parseTableParams(await searchParams, {
    sort: refundTable.sort,
    defaultSort: "cancelledAt",
    defaultDir: "asc",
    pageSize: 25,
    filters: refundTable.filters,
  })
  const [{ view, rows, total }, owed, t, locale] = await Promise.all([
    listRefunds(params),
    refundsOwed(),
    getTranslations("money.refunds"),
    getLocale(),
  ])
  const n = (v: number) => formatNumber(v, locale)
  const tw = await getTranslations("workshops.registrations")

  const columns: Column<RefundRow>[] = [
    {
      key: "person",
      header: t("columns.person"),
      primary: true,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium">{r.member.name}</span>
          {r.participantName !== r.member.name && (
            <span className="text-muted-foreground block truncate text-xs">{t("for", { name: r.participantName })}</span>
          )}
          {/* On phones the contact and the workshop go under the name. */}
          <span className="text-muted-foreground block truncate text-xs md:hidden">
            <bdi dir="ltr">{r.member.phone ?? r.member.email}</bdi>
          </span>
          <span className="text-muted-foreground block truncate text-xs lg:hidden">{localized(r.course.title, locale)}</span>
        </span>
      ),
    },
    {
      key: "contact",
      header: t("columns.contact"),
      hideBelow: "md",
      cell: (r) => (
        <span className="block min-w-0 text-xs">
          <a href={`mailto:${r.member.email}`} className="text-muted-foreground hover:text-primary block truncate">
            <bdi>{r.member.email}</bdi>
          </a>
          {r.member.phone && (
            <a href={`tel:${r.member.phone.replace(/[^+\d]/g, "")}`} className="text-muted-foreground hover:text-primary block">
              <bdi dir="ltr">{r.member.phone}</bdi>
            </a>
          )}
        </span>
      ),
    },
    {
      key: "workshop",
      header: t("columns.workshop"),
      hideBelow: "lg",
      cell: (r) => (
        <span className="block min-w-0">
          <Link
            href={`/admin/workshops/${r.course.id}/registrations`}
            className="hover:text-primary block max-w-56 truncate text-sm underline-offset-4 hover:underline"
          >
            {localized(r.course.title, locale)}
          </Link>
          <span className="text-muted-foreground block text-xs">{formatDate(r.course.startsAt, locale, "medium")}</span>
        </span>
      ),
    },
    {
      key: "reason",
      header: t("columns.reason"),
      hideBelow: "sm",
      cell: (r) => {
        const reason = refundReason(r)
        const share = r.amount > 0 && r.refundAmount ? r.refundAmount / r.amount : 0
        return (
          <span className="flex flex-col items-start gap-1">
            <StatusBadge tone={reason === "workshopCancelled" ? "danger" : "neutral"}>{t(`reason.${reason}`)}</StatusBadge>
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {t("reason.share", { total: formatPercent(share, locale, 0) })}
              {r.paymentMethod && ` · ${tw(`methods.${r.paymentMethod}`)}`}
            </span>
          </span>
        )
      },
    },
    {
      key: view === "refunded" ? "refundedAt" : "cancelledAt",
      header: view === "refunded" ? t("columns.refundedOn") : t("columns.cancelledOn"),
      hideBelow: "md",
      cell: (r) => {
        const at = view === "refunded" ? r.refundedAt : r.cancelledAt
        return <span className="text-muted-foreground text-xs whitespace-nowrap">{at ? formatDate(at, locale, "medium") : ""}</span>
      },
    },
    {
      key: "amount",
      header: t("columns.amount"),
      align: "end",
      sortable: true,
      cell: (r) => <Money value={r.refundAmount ?? 0} className="font-medium" />,
    },
    ...(view === "owed"
      ? [
          {
            key: "actions",
            header: <span className="sr-only">{t("columns.actions")}</span>,
            align: "end" as const,
            cell: (r: RefundRow) => (
              <span className="flex flex-wrap items-center justify-end gap-1">
                {/* A cancelled workshop already refunds in full; a single cancellation can be raised (or lowered) first. */}
                {refundReason(r) === "registrationCancelled" && (
                  <ChangeRefundButton
                    id={r.id}
                    paid={r.amount}
                    refund={r.refundAmount ?? 0}
                    name={r.member.name}
                    participant={r.participantName}
                  />
                )}
                <MarkRefundedButton
                  id={r.id}
                  amount={r.refundAmount ?? 0}
                  name={r.member.name}
                  workshop={localized(r.course.title, locale)}
                />
              </span>
            ),
          },
        ]
      : []),
  ]

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <dl className="mb-5 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="bg-card ring-foreground/8 rounded-xl px-4 py-3 shadow-xs ring-1">
          <dt className="text-muted-foreground text-xs">{t("owedTotal")}</dt>
          <dd className={owed.amount > 0 ? "text-info mt-1 text-xl font-semibold" : "mt-1 text-xl font-semibold"}>
            <Money value={owed.amount} />
          </dd>
        </div>
        <div className="bg-card ring-foreground/8 rounded-xl px-4 py-3 shadow-xs ring-1">
          <dt className="text-muted-foreground text-xs">{t("owedCount")}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{n(owed.count)}</dd>
        </div>
      </dl>
      <DataTable
        columns={columns}
        rows={rows}
        total={total}
        params={params}
        rowKey={(r) => r.id}
        searchPlaceholder={t("search")}
        filters={[{ key: "view", label: t("views.label"), options: refundViews.map((v) => ({ value: v, label: t(`views.${v}`) })) }]}
        empty={
          <EmptyState icon={HandCoinsIcon} title={t("empty.title")} description={t("empty.description")} />
        }
      />
    </>
  )
}
