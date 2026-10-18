import { eq } from "drizzle-orm"
import { hasLocale } from "next-intl"
import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { db } from "@/db"
import { courses } from "@/db/schema"
import { csvDate, lira, toCsv, type Cell } from "@/features/money/csv"
import { today } from "@/features/money/ledger"
import { listHolds } from "@/features/registrations/admin/holds"
import { exportRegistrations } from "@/features/registrations/admin/queries"
import { paymentState } from "@/features/registrations/schema"
import { routing } from "@/i18n/routing"
import { audit } from "@/lib/audit"
import { requireAdminApi } from "@/lib/auth/admin"
import { zonedParts } from "@/lib/format"
import { registrationDay, workshopDays } from "@/features/workshops/days"

/**
 * CSV of a workshop's registrations (participant, member's contact, payment,
 * refund, consents), column titles and dates in the page's language and its
 * calendar. Super admins only; every export is written to the audit log. Safe
 * against CSV / formula injection (`toCsv`): names and phone numbers are
 * typed by members.
 */
export async function GET(request: Request, ctx: RouteContext<"/[locale]/admin/workshops/[id]/registrations/export">) {
  const session = await requireAdminApi(request)
  if (!session) return new Response(null, { status: 401 })

  const { locale: requested, id } = await ctx.params
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 })
  const [course] = await db
    .select({ slug: courses.slug, startsAt: courses.startsAt, endsAt: courses.endsAt, days: courses.days })
    .from(courses)
    .where(eq(courses.id, id))
  if (!course) return new Response(null, { status: 404 })
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale
  const t = await getTranslations({ locale, namespace: "workshops.registrations" })

  const [rows, holds] = await Promise.all([exportRegistrations(id), listHolds(id)])
  // Istanbul days, in the language's calendar (Persian: "1405/07/16").
  const day = (value: Date | null) => (value ? csvDate(zonedParts(value).date, locale) : "")
  const yesNo = (value: boolean) => (value ? t("csv.yes") : t("csv.no"))
  // Several days: which day each person comes (with the hours when two sessions share a date).
  const days = workshopDays(course)
  const several = days.length > 1
  // The day as stored, or the first one when that day was removed since (a cancelled registration may keep it).
  const dayCell = (index: number | null) => {
    const d = registrationDay(course, index)
    const date = zonedParts(d.startsAt).date
    const shared = days.filter((o) => zonedParts(o.startsAt).date === date).length > 1
    return shared ? `${day(d.startsAt)} ${zonedParts(d.startsAt).time}–${zonedParts(d.endsAt).time}` : day(d.startsAt)
  }
  // Held places and invited guests take places too: listed after the registrations, with how many places each.
  const withHolds = holds.length > 0
  const columns = [
    "participant",
    ...(several ? (["day"] as const) : []),
    "member",
    "email",
    "phone",
    "payment",
    "amount",
    "method",
    "paidOn",
    "refund",
    "refundedOn",
    "photos",
    "videos",
    "registeredOn",
    ...(withHolds ? (["places"] as const) : []),
  ] as const
  const table: Cell[][] = [
    columns.map((c) => t(`csv.${c}`)),
    ...rows.map((r) => [
      r.participantName,
      ...(several ? [dayCell(r.day)] : []),
      r.member.name,
      r.member.email,
      r.member.phone ?? "",
      t(`state.${paymentState(r)}`),
      lira(r.amount),
      r.paymentMethod ? t(`methods.${r.paymentMethod}`) : "",
      day(r.paidAt),
      r.refundAmount ? lira(r.refundAmount) : "",
      day(r.refundedAt),
      yesNo(r.photoConsent),
      yesNo(r.videoConsent),
      day(r.createdAt),
      // A cancelled registration takes no place.
      ...(withHolds ? [r.status === "cancelled" ? 0 : 1] : []),
    ]),
    ...holds.map((h) => [
      h.note || t("holds.guests"),
      ...(several ? [dayCell(h.day)] : []),
      "",
      "",
      "",
      h.invited ? t("csv.invited") : t("csv.held"),
      lira(0),
      "",
      "",
      "",
      "",
      "",
      "",
      day(h.createdAt),
      h.count,
    ]),
  ]

  await audit({
    adminId: session.admin.id,
    action: "registration.export",
    entity: "workshop",
    entityId: id,
    data: { rows: rows.length, holds: holds.length },
  })
  return new Response(toCsv(table), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="registrations_${course.slug}_${today()}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
