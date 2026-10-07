import { TicketIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { DataTable, type Column } from "@/components/admin/data-table/data-table"
import { parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { PageHeader } from "@/components/admin/page-header"
import { RegistrationActions } from "@/features/registrations/admin/components/dialogs"
import { PaymentCell, refundOwed } from "@/features/registrations/admin/components/payment-cell"
import { countRegistrationViews, listRegistrations, type AllRegistrationRow } from "@/features/registrations/admin/queries"
import {
  allRegistrationsTable,
  allRegistrationViews,
  paymentMethods,
  type AllRegistrationView,
  type PaymentMethod,
} from "@/features/registrations/admin/schema"
import { isCancelled } from "@/features/workshops/schema"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatNumber, localized } from "@/lib/format"
import { getSetting } from "@/lib/settings"
import { cn } from "@/lib/utils"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workshops.registrations.all")
  return { title: t("title") }
}

/**
 * Registrations of every workshop in one list: "not paid yet" first (a bank
 * transfer's description has the participant's name: search for it), then
 * paid, cancelled or all. Each row has the same actions as the workshop's
 * own Registrations tab, except on a cancelled workshop or closed books.
 */
export default async function RegistrationsPage({ searchParams }: PageProps<"/[locale]/admin/registrations">) {
  await requireAdmin()
  const params = parseTableParams(await searchParams, {
    sort: allRegistrationsTable.sort,
    defaultSort: "createdAt",
    defaultDir: "desc",
    pageSize: 50,
    filters: allRegistrationsTable.filters,
  })
  const [{ view, rows, total }, counts, payment, t, tc, locale] = await Promise.all([
    listRegistrations(params),
    countRegistrationViews(),
    getSetting("payment"),
    getTranslations("workshops.registrations"),
    getTranslations("common.table"),
    getLocale(),
  ])

  const defaultMethod: PaymentMethod =
    paymentMethods.find((m) => (m === "cash" ? payment.cash : payment[m].enabled)) ?? "cash"
  // As on the workshop's tab: a cancelled workshop's registrations are all cancelled; closed books can't change.
  const locked = (course: AllRegistrationRow["course"]) =>
    isCancelled(course) || course.closedAt !== null || course.status === "closed"

  const columns: Column<AllRegistrationRow>[] = [
    {
      key: "participant",
      header: t("table.participant"),
      sortable: true,
      primary: true,
      cell: (r) => (
        <span className={cn("block min-w-0", r.status === "cancelled" && "opacity-70")}>
          <span className="block truncate font-medium">{r.participantName}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {t("table.registeredOn", { date: formatDate(r.createdAt, locale, "medium") })}
          </span>
          {/* On phones the workshop and the member's contact go under the name. */}
          <span className="text-muted-foreground block truncate text-xs lg:hidden">{localized(r.course.title, locale)}</span>
          <span className="text-muted-foreground block truncate text-xs md:hidden">
            {r.member.name} · <bdi>{r.member.phone ?? r.member.email}</bdi>
          </span>
        </span>
      ),
    },
    {
      key: "workshop",
      header: t("all.workshop"),
      sortable: true,
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
      key: "member",
      header: t("table.member"),
      hideBelow: "md",
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block text-sm">{r.member.name}</span>
          <a href={`mailto:${r.member.email}`} className="text-muted-foreground hover:text-primary block truncate text-xs">
            <bdi>{r.member.email}</bdi>
          </a>
          {r.member.phone && (
            <a
              href={`tel:${r.member.phone.replace(/[^+\d]/g, "")}`}
              className="text-muted-foreground hover:text-primary block text-xs"
            >
              <bdi dir="ltr">{r.member.phone}</bdi>
            </a>
          )}
        </span>
      ),
    },
    {
      key: "payment",
      header: t("table.payment"),
      cell: (r) => <PaymentCell row={r} t={t} locale={locale} />,
    },
    {
      key: "amount",
      header: t("table.amount"),
      align: "end",
      hideBelow: "sm",
      cell: (r) => <Money value={r.amount} className={cn("text-sm", r.status === "cancelled" && "text-muted-foreground")} />,
    },
    {
      key: "createdAt",
      header: t("table.registeredAt"),
      sortable: true,
      hideBelow: "lg",
      cell: (r) => <span className="text-muted-foreground text-xs whitespace-nowrap">{formatDate(r.createdAt, locale, "medium")}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("table.actions")}</span>,
      align: "end",
      cell: (r) =>
        locked(r.course) ? null : (
          <RegistrationActions
            registration={{
              id: r.id,
              participantName: r.participantName,
              memberName: r.member.name,
              status: r.status,
              amount: r.amount,
              refundOwed: refundOwed(r),
            }}
            startsAt={r.course.startsAt.toISOString()}
            defaultMethod={defaultMethod}
          />
        ),
    },
  ]

  const tabLabel = (v: AllRegistrationView) => (v === "all" ? tc("all") : t(`filter.${v}`))
  const tabHref = (v: AllRegistrationView) => ({
    pathname: "/admin/registrations",
    query: { ...(v === "unpaid" ? {} : { view: v }), ...(params.q ? { q: params.q } : {}) },
  })

  return (
    <>
      <PageHeader title={t("all.title")} description={t("all.description")} />
      {counts.all === 0 ? (
        <EmptyState icon={TicketIcon} title={t("empty.title")} description={t("all.empty")} />
      ) : (
        <div className="space-y-4">
          <nav aria-label={t("filter.label")} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <ul className="bg-muted/60 flex w-max gap-0.5 rounded-xl p-1">
              {allRegistrationViews.map((v) => {
                const current = v === view
                return (
                  <li key={v}>
                    <Link
                      href={tabHref(v)}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-all",
                        current
                          ? "bg-background text-foreground ring-foreground/8 shadow-xs ring-1"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tabLabel(v)}
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-xs tabular-nums",
                          current ? "bg-primary/10 text-primary" : "bg-foreground/5",
                        )}
                      >
                        {formatNumber(counts[v], locale)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
          <DataTable
            columns={columns}
            rows={rows}
            total={total}
            params={params}
            rowKey={(r) => r.id}
            searchPlaceholder={t("search")}
          />
        </div>
      )}
    </>
  )
}
