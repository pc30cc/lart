import { CameraIcon, CameraOffIcon, DownloadIcon, TicketIcon, VideoIcon, VideoOffIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { DataTable, type Column } from "@/components/admin/data-table/data-table"
import { parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { Button } from "@/components/ui/button"
import { RegistrationActions } from "@/features/registrations/admin/components/dialogs"
import { AddRegistrationDialog } from "@/features/registrations/admin/components/add-registration-dialog"
import { HoldActions, HoldName, HoldSeatsDialog, HoldsButton, HoldStepper, type HoldRow } from "@/features/registrations/admin/components/hold-seats"
import { holdsForView, holdsOnPage } from "@/features/registrations/admin/hold-rows"
import { listHolds } from "@/features/registrations/admin/holds"
import { registrableWorkshops } from "@/features/registrations/admin/register"
import { PaymentCell, refundOwed } from "@/features/registrations/admin/components/payment-cell"
import { listWorkshopRegistrations, registrationSummary, type AdminRegistrationRow } from "@/features/registrations/admin/queries"
import { seatsTakenByDay } from "@/features/registrations/public"
import { paymentMethods, registrationTable, registrationViews, type PaymentMethod } from "@/features/registrations/admin/schema"
import { dayDateLabel, registrationDay, workshopDays } from "@/features/workshops/days"
import { getWorkshop } from "@/features/workshops/queries"
import { isCancelled } from "@/features/workshops/schema"
import { localeHref } from "@/i18n/links"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatDateTime, formatNumber, localized } from "@/lib/format"
import { getSetting } from "@/lib/settings"
import { publicUrls } from "@/lib/storage"
import { cn } from "@/lib/utils"
import { WorkshopHeader } from "../../_components/workshop-header"

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/workshops/[id]/registrations">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [workshop, t, locale] = await Promise.all([getWorkshop(id), getTranslations("workshops"), getLocale()])
  return workshop ? { title: t("registrations.metaTitle", { title: localized(workshop.title, locale) }) } : {}
}

/**
 * Who registered and whether they paid: totals, the list (filter, search,
 * CSV) and, per registration, "Record payment" and "Cancel registration";
 * on a cancelled, paid one not paid back yet, "Change refund".
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
  const [workshop, summary, { rows, total }, payment, t, locale, holds, perDay] = await Promise.all([
    getWorkshop(id),
    registrationSummary(id),
    listWorkshopRegistrations(id, tableParams),
    getSetting("payment"),
    getTranslations("workshops.registrations"),
    getLocale(),
    listHolds(id),
    // Places taken on each day as the site counts them: registrations (not cancelled) and held places.
    seatsTakenByDay(id),
  ])
  if (!workshop) notFound()
  const exportHref = await localeHref(locale, `/admin/workshops/${workshop.id}/registrations/export`)
  // "Add registration" offers this workshop (when it still takes people) first.
  const addable = await registrableWorkshops(locale)
  // "Hold places" needs this workshop still taking people (its days and the places left).
  const holdable = addable.find((w) => w.id === id)

  const n = (v: number) => formatNumber(v, locale)
  // Held places and invited guests: taken like registrations, so the totals match the site's.
  const held = holds.reduce((s, h) => s + h.count, 0)
  // A cancelled workshop's registrations are all cancelled; closed books can't change.
  const locked = isCancelled(workshop) || workshop.closedAt !== null || workshop.status === "closed"
  const url = await publicUrls()
  const defaultMethod: PaymentMethod =
    paymentMethods.find((m) => (m === "cash" ? payment.cash : payment[m].enabled)) ?? "cash"
  // Several days: each registration's day (cancelling and refunds count to it).
  const days = workshopDays(workshop)
  const dayTab = tableParams.filters.day
  // Two sessions on one date: the label gives the hours too.
  const dayLabel = (day: number | null) => t("table.day", { n: n((day ?? 0) + 1), date: dayDateLabel(workshop, day, locale) })
  const holdRows: HoldRow[] = holds.map((h) => ({
    id: h.id,
    courseId: workshop.id,
    day: h.day,
    count: h.count,
    note: h.note,
    invited: h.invited,
    by: h.by,
    createdAt: h.createdAt.toISOString(),
    dayLabel: days.length > 1 ? dayLabel(h.day) : null,
  }))
  // Held places and invited guests are rows of the list too (after the registrations): they take places like
  // registrations, so the list adds up to the numbers above and on the workshops list ("8 of 8").
  const heldInView = holdsForView(holdRows, { status: tableParams.filters.status, day: dayTab, q: tableParams.q })
  const heldHere = holdsOnPage(heldInView, total, rows.length, tableParams)

  const registrationColumns: Column<AdminRegistrationRow>[] = [
    {
      key: "participant",
      header: t("table.participant"),
      sortable: true,
      primary: true,
      cell: (r) => (
        <span className={cn("block min-w-0", r.status === "cancelled" && "opacity-70")}>
          <span className="block truncate font-medium">{r.participantName}</span>
          {days.length > 1 && <span className="text-primary block truncate text-xs font-medium">{dayLabel(r.day)}</span>}
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
          <Link href={`/admin/students/${r.member.id}`} className="hover:text-primary block text-sm transition-colors">
            {r.member.name}
          </Link>
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
      cell: (r) => <PaymentCell row={r} t={t} locale={locale} receiptUrl={url(r.receiptPath)} />,
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
                  refundOwed: refundOwed(r),
                }}
                startsAt={registrationDay(workshop, r.day).startsAt.toISOString()}
                defaultMethod={(r.paymentChoice as PaymentMethod | null) ?? defaultMethod}
              />
            ),
          },
        ]),
  ]

  // A held place's cells, column by column (the others stay empty).
  const holdCells: Record<string, (h: HoldRow) => React.ReactNode> = {
    participant: (h) => (
      <span className="block min-w-0">
        <HoldName hold={h} stacked />
        {/* The places column is hidden on phones (and no stepper on a locked workshop): the number goes here. */}
        <span className="block text-xs font-semibold tabular-nums sm:hidden">{t("holds.row.places", { count: h.count })}</span>
        {h.dayLabel && <span className="text-primary block truncate text-xs font-medium">{h.dayLabel}</span>}
        <span className="text-muted-foreground block truncate text-xs">
          {t("holds.by", { name: h.by ?? "—", date: formatDateTime(h.createdAt, locale, "medium") })}
        </span>
      </span>
    ),
    member: () => <span className="text-muted-foreground text-xs">{t("holds.row.noAccount")}</span>,
    payment: (h) => (
      <span className={cn("text-xs font-medium", h.invited ? "text-success" : "text-muted-foreground")}>
        {h.invited ? t("holds.row.free") : t("holds.row.held")}
      </span>
    ),
    amount: (h) => <span className="text-muted-foreground text-sm tabular-nums">{t("holds.row.places", { count: h.count })}</span>,
    createdAt: (h) => <span className="text-muted-foreground text-xs whitespace-nowrap">{formatDate(new Date(h.createdAt), locale, "medium")}</span>,
    actions: (h) => (
      <span className="flex items-center justify-end gap-1">
        {/* On phones the row stays narrow: the stepper waits for a wider screen (the number is under the name). */}
        <span className="hidden sm:contents">
          <HoldStepper hold={h} locked={locked} registrable={Boolean(holdable)} />
        </span>
        {!locked && <HoldActions hold={h} workshops={addable} compact />}
      </span>
    ),
  }
  type Row = { kind: "registration"; registration: AdminRegistrationRow } | { kind: "hold"; hold: HoldRow }
  const columns: Column<Row>[] = registrationColumns.map((col) => ({
    ...col,
    cell: (row: Row) => (row.kind === "registration" ? col.cell(row.registration) : (holdCells[col.key]?.(row.hold) ?? null)),
  }))
  const tableRows: Row[] = [
    ...rows.map((registration) => ({ kind: "registration" as const, registration })),
    ...heldHere.map((hold) => ({ kind: "hold" as const, hold })),
  ]

  const cards = [
    {
      label: t("summary.registered"),
      value: n(summary.active + held),
      // Several days: the day tabs below give each day's places; one total of places would mislead here.
      sub: held
        ? t(days.length > 1 ? "summary.withHoldsDays" : "summary.withHolds", { registered: n(summary.active), held: n(held), max: n(workshop.maxCapacity) })
        : t("summary.places", { max: n(workshop.maxCapacity), min: n(workshop.minCapacity) }),
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
          <>
            <HoldsButton
              locked={locked}
              workshops={addable}
              holds={holdRows}
            />
            {!locked && holdable && <HoldSeatsDialog workshops={addable} courseId={holdable.id} />}
            {!locked && <AddRegistrationDialog workshops={addable} courseId={workshop.id} />}
            {summary.active + summary.cancelled + held > 0 && (
              <Button asChild variant="outline" size="lg" className="px-4">
                <a href={exportHref} download>
                  <DownloadIcon />
                  {t("export")}
                </a>
              </Button>
            )}
          </>
        }
      />
      {summary.active + summary.cancelled === 0 && held === 0 ? (
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
          {/* Several days: a tab per day with that day's participants only (no cancelled ones). */}
          {days.length > 1 && (
            <nav aria-label={t("byDay")} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
              <ul className="bg-muted/60 inline-flex gap-1 rounded-xl p-1">
                <li>
                  <DayTab href={`/admin/workshops/${workshop.id}/registrations`} active={dayTab === undefined}>
                    {t("allDays")}
                    <span className="bg-background/70 rounded-full px-1.5 text-xs tabular-nums">{n(perDay.reduce((a, b) => a + b, 0))}</span>
                  </DayTab>
                </li>
                {days.map((d, i) => (
                  <li key={i}>
                    <DayTab href={`/admin/workshops/${workshop.id}/registrations?day=${i}`} active={dayTab === String(i)}>
                      {dayLabel(i)}
                      <span className="bg-background/70 rounded-full px-1.5 text-xs tabular-nums">
                        {t("dayCount", { taken: n(perDay[i] ?? 0), max: n(d.maxCapacity ?? workshop.maxCapacity) })}
                      </span>
                    </DayTab>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <DataTable
            columns={columns}
            rows={tableRows}
            total={total + heldInView.length}
            params={tableParams}
            rowKey={(r) => (r.kind === "registration" ? r.registration.id : `hold-${r.hold.id}`)}
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

function DayTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
        active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  )
}
