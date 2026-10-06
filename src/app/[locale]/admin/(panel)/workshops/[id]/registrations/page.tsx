import { CameraIcon, CameraOffIcon, TicketIcon, VideoIcon, VideoOffIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { StatusBadge, type StatusTone } from "@/components/admin/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getWorkshop, listRegistrations, type RegistrationRow } from "@/features/workshops/queries"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatNumber, localized } from "@/lib/format"
import { cn } from "@/lib/utils"
import { WorkshopHeader } from "../../_components/workshop-header"

const tone: Record<RegistrationRow["status"], StatusTone> = { pending: "warning", confirmed: "success", cancelled: "neutral" }

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/workshops/[id]/registrations">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [workshop, t, locale] = await Promise.all([getWorkshop(id), getTranslations("workshops"), getLocale()])
  return workshop ? { title: t("registrations.metaTitle", { title: localized(workshop.title, locale) }) } : {}
}

/** Who registered: read-only in phase 1 (per-registration changes and refunds come with the Registrations section later). */
export default async function WorkshopRegistrationsPage({ params }: PageProps<"/[locale]/admin/workshops/[id]/registrations">) {
  await requireAdmin()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const [workshop, rows, t, locale] = await Promise.all([
    getWorkshop(id),
    listRegistrations(id),
    getTranslations("workshops"),
    getLocale(),
  ])
  if (!workshop) notFound()
  const n = (v: number) => formatNumber(v, locale)
  const attending = rows.filter((r) => r.status === "confirmed")
  const stats = [
    { label: t("registrations.stats.confirmed"), value: workshop.registered.confirmed },
    { label: t("registrations.stats.pending"), value: workshop.registered.pending },
    { label: t("registrations.stats.cancelled"), value: workshop.registered.cancelled },
    { label: t("registrations.stats.photos"), value: attending.filter((r) => r.photoConsent).length },
    { label: t("registrations.stats.videos"), value: attending.filter((r) => r.videoConsent).length },
  ]

  return (
    <>
      <WorkshopHeader workshop={workshop} active="registrations" />
      {rows.length === 0 ? (
        <EmptyState
          icon={TicketIcon}
          title={t("registrations.empty.title")}
          description={
            workshop.status === "awaiting_signature"
              ? t("registrations.empty.awaiting")
              : t("registrations.empty.description")
          }
        />
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {stats.map((s) => (
              <div key={s.label} className="bg-card ring-foreground/8 rounded-xl px-4 py-3 shadow-xs ring-1">
                <dt className="text-muted-foreground text-xs">{s.label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{n(s.value)}</dd>
              </div>
            ))}
          </dl>

          <div className="bg-card ring-foreground/8 overflow-hidden rounded-xl shadow-xs ring-1">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-muted-foreground h-11 px-4 text-start text-xs font-medium">
                    {t("registrations.table.participant")}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden h-11 px-4 text-start text-xs font-medium md:table-cell">
                    {t("registrations.table.member")}
                  </TableHead>
                  <TableHead className="text-muted-foreground h-11 px-4 text-start text-xs font-medium">
                    {t("registrations.table.status")}
                  </TableHead>
                  <TableHead className="text-muted-foreground h-11 px-4 text-start text-xs font-medium">
                    {t("registrations.table.consent")}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden h-11 px-4 text-end text-xs font-medium sm:table-cell">
                    {t("registrations.table.paid")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={cn(r.status === "cancelled" && "opacity-60")}>
                    <TableCell className="px-4 py-3">
                      <span className="block font-medium">{r.participantName}</span>
                      <span className="text-muted-foreground block text-xs">
                        {t("registrations.table.registeredOn", { date: formatDate(r.createdAt, locale, "medium") })}
                      </span>
                      {/* On phones the member's contact goes under the name. */}
                      <span className="text-muted-foreground block text-xs md:hidden">
                        <bdi>{r.member.email}</bdi>
                      </span>
                    </TableCell>
                    <TableCell className="hidden px-4 py-3 md:table-cell">
                      <span className="block text-sm">{r.member.name}</span>
                      <a href={`mailto:${r.member.email}`} className="text-muted-foreground hover:text-primary block text-xs">
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
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge tone={tone[r.status]}>{t(`registrations.status.${r.status}`)}</StatusBadge>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <Consent ok={r.photoConsent} on={CameraIcon} off={CameraOffIcon}>
                          {r.photoConsent ? t("registrations.consent.photoYes") : t("registrations.consent.photoNo")}
                        </Consent>
                        <Consent ok={r.videoConsent} on={VideoIcon} off={VideoOffIcon}>
                          {r.videoConsent ? t("registrations.consent.videoYes") : t("registrations.consent.videoNo")}
                        </Consent>
                      </span>
                    </TableCell>
                    <TableCell className="hidden px-4 py-3 text-end sm:table-cell">
                      {r.status === "cancelled" ? (
                        r.refundAmount ? (
                          <span className="text-xs">
                            {t("registrations.table.refund")} <Money value={r.refundAmount} />
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">{t("registrations.table.noRefund")}</span>
                        )
                      ) : r.paidAt ? (
                        <span className="block">
                          <Money value={r.amount} className="text-sm" />
                          <span className="text-muted-foreground block text-xs">{formatDate(r.paidAt, locale, "medium")}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">{t("registrations.table.notPaid")}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground px-1 text-xs">{t("registrations.readOnly")}</p>
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
