import { CameraIcon, CameraOffIcon, DownloadIcon, TicketIcon, VideoIcon, VideoOffIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { DataTable, type Column } from "@/components/admin/data-table/data-table"
import { parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { StatusBadge, type StatusTone } from "@/components/admin/status-badge"
import { Button } from "@/components/ui/button"
import { RegistrationActions } from "@/features/registrations/admin/components/dialogs"
import { listWorkshopRegistrations, registrationSummary, type AdminRegistrationRow } from "@/features/registrations/admin/queries"
import { paymentMethods, registrationTable, registrationViews, type PaymentMethod } from "@/features/registrations/admin/schema"
import { paymentState, refundState } from "@/features/registrations/schema"
import { getWorkshop } from "@/features/workshops/queries"
import { isCancelled } from "@/features/workshops/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatNumber, localized } from "@/lib/format"
import { getSetting } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { WorkshopHeader } from "../../_components/workshop-header"

const tones = { unpaid: "warning", paid: "success", free: "success", cancelled: "neutral" } as const satisfies Record<
  string,
  StatusTone
>

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/workshops/[id]/registrations">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [workshop, t, locale] = await Promise.all([getWorkshop(id), getTranslations("workshops"), getLocale()])
  return workshop ? { title: t("registrations.metaTitle", { title: localized(workshop.title, locale) }) } : {}
}

/**
 * Who registered and whether they paid: totals, the list (filter, search,
 * CSV) and, per registration, "Record payment" and "Cancel registration".
 */
export default async function WorkshopRegistrationsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/workshops/[id]/registrations">) {
  await requireAdmin()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const tableParams = parseTableParams(await searchParams, {
    sort: registrationTable.sort,
    defaultSort: "createdAt",
    defaultDir: "asc",
    pageSize: 50,
    filters: registrationTable.filters,
  })
  const [workshop, summary, { rows, total }, payment, t, locale] = await Promise.all([
    getWorkshop(id),
    registrationSummary(id),
    listWorkshopRegistrations(id, tableParams),
    getSetting("payment"),
    getTranslations("workshops.registrations"),
    getLocale(),
  ])
  if (!workshop) notFound()

  const n = (v: number) => formatNumber(v, locale)
  // A cancelled workshop's registrations are all cancelled; closed books can't change.
  const locked = isCancelled(workshop) || workshop.closedAt !== null || workshop.status === "closed"
  const defaultMethod: PaymentMethod =
    paymentMethods.find((m) => (m === "cash" ? payment.cash : payment[m].enabled)) ?? "cash"
  const startsAt = workshop.startsAt.toISOString()

  const columns: Column<AdminRegistrationRow>[] = [
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
          {/* On phones the member's contact goes under the name. */}
          <span className="text-muted-foreground block truncate text-xs md:hidden">
            {r.member.name} · <bdi>{r.member.phone ?? r.member.email}</bdi>
          </span>
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
      key: "consent",
      header: t("table.consent"),
      hideBelow: "lg",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Consent ok={r.photoConsent} on={CameraIcon} off={CameraOffIcon}>
            {r.photoConsent ? t("consent.photoYes") : t("consent.photoNo")}
          </Consent>
          <Consent ok={r.videoConsent} on={VideoIcon} off={VideoOffIcon}>
            {r.videoConsent ? t("consent.videoYes") : t("consent.videoNo")}
          </Consent>
        </span>
      ),
    },
    {
      key: "createdAt",
      header: t("table.registeredAt"),
      sortable: true,
      hideBelow: "lg",
      cell: (r) => <span className="text-muted-foreground text-xs whitespace-nowrap">{formatDate(r.createdAt, locale, "medium")}</span>,
    },
    ...(locked
      ? []
      : [
          {
            key: "actions",
            header: <span className="sr-only">{t("table.actions")}</span>,
            align: "end" as const,
            cell: (r: AdminRegistrationRow) => (
              <RegistrationActions
                registration={{
                  id: r.id,
                  participantName: r.participantName,
                  memberName: r.member.name,
                  status: r.status,
                  amount: r.amount,
                }}
                startsAt={startsAt}
                defaultMethod={defaultMethod}
              />
            ),
          },
        ]),
  ]

  const cards = [
    {
      label: t("summary.registered"),
      value: n(summary.active),
      sub: t("summary.places", { max: n(workshop.maxCapacity), min: n(workshop.minCapacity) }),
    },
    {
      label: t("summary.paid"),
      value: <Money value={summary.paidAmount} />,
      sub: t("summary.people", { count: summary.paid }),
      tone: "text-success",
    },
    {
      label: t("summary.unpaid"),
      value: <Money value={summary.unpaidAmount} />,
      sub: t("summary.people", { count: summary.unpaid }),
      tone: summary.unpaid > 0 ? "text-warning" : undefined,
    },
    ...(summary.refundsOwed > 0
      ? [
          {
            label: t("summary.refundsOwed"),
            value: <Money value={summary.refundsOwedAmount} />,
            sub: t("summary.people", { count: summary.refundsOwed }),
            tone: "text-info",
          },
        ]
      : [
          {
            label: t("summary.consent"),
            value: t("summary.consentValue", { photos: n(summary.photos), videos: n(summary.videos) }),
            sub: t("summary.consentHint"),
          },
        ]),
  ]

  return (
    <>
      <WorkshopHeader
        workshop={workshop}
        active="registrations"
        actions={
          summary.active + summary.cancelled > 0 ? (
            <Button asChild variant="outline" size="lg" className="px-4">
              <a href={`/${locale}/admin/workshops/${workshop.id}/registrations/export`} download>
                <DownloadIcon />
                {t("export")}
              </a>
            </Button>
          ) : undefined
        }
      />
      {summary.active + summary.cancelled === 0 ? (
        <EmptyState
          icon={TicketIcon}
          title={t("empty.title")}
          description={workshop.status === "awaiting_signature" ? t("empty.awaiting") : t("empty.description")}
        />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((card) => (
              <div key={card.label} className="bg-card ring-foreground/8 rounded-xl px-4 py-3 shadow-xs ring-1">
                <dt className="text-muted-foreground text-xs">{card.label}</dt>
                <dd className={cn("mt-1 text-xl font-semibold tabular-nums", card.tone)}>{card.value}</dd>
                <dd className="text-muted-foreground mt-0.5 text-xs">{card.sub}</dd>
              </div>
            ))}
          </dl>

          <DataTable
            columns={columns}
            rows={rows}
            total={total}
            params={tableParams}
            rowKey={(r) => r.id}
            searchPlaceholder={t("search")}
            filters={[
              {
                key: "status",
                label: t("filter.label"),
                options: registrationViews.map((v) => ({ value: v, label: t(`filter.${v}`) })),
              },
            ]}
          />
          {locked && <p className="text-muted-foreground px-1 text-xs">{t("locked")}</p>}
        </div>
      )}
    </>
  )
}

type Translate = (key: string, values?: Record<string, string | number>) => string

/** "Not paid yet" / "Paid · Cash · 3 Oct" / "Free" / "Cancelled" with its refund. */
function PaymentCell({ row: r, t, locale }: { row: AdminRegistrationRow; t: Translate; locale: string }) {
  const state = paymentState(r)
  const refund = state === "cancelled" ? refundState(r) : "none"
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={tones[state]}>{t(`state.${state}`)}</StatusBadge>
      {state === "paid" && r.paidAt && (
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {t("state.paidVia", { method: r.paymentMethod ?? "other", date: formatDate(r.paidAt, locale, "medium") })}
        </span>
      )}
      {refund === "due" && (
        <span className="text-info text-xs whitespace-nowrap">
          {t("state.refundOwed")} <Money value={r.refundAmount ?? 0} />
        </span>
      )}
      {refund === "sent" && r.refundedAt && (
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {t("state.refundSent", { date: formatDate(r.refundedAt, locale, "medium") })} <Money value={r.refundAmount ?? 0} />
        </span>
      )}
      {state === "cancelled" && refund === "none" && r.paidAt && (
        <span className="text-muted-foreground text-xs">{t("state.noRefund")}</span>
      )}
    </span>
  )
}

function Consent({
  ok,
  on: On,
  off: Off,
  children,
}: {
  ok: boolean
  on: React.ComponentType<{ className?: string }>
  off: React.ComponentType<{ className?: string }>
  children: string
}) {
  const Icon = ok ? On : Off
  return (
    <span
      title={children}
      className={cn(
        "flex size-7 items-center justify-center rounded-full",
        ok ? "bg-success/12 text-success" : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" />
      <span className="sr-only">{children}</span>
    </span>
  )
}
