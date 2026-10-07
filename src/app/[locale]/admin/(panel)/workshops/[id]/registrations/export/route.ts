import { eq } from "drizzle-orm"
import { hasLocale } from "next-intl"
import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { db } from "@/db"
import { courses } from "@/db/schema"
import { lira, toCsv, type Cell } from "@/features/money/csv"
import { today } from "@/features/money/ledger"
import { exportRegistrations } from "@/features/registrations/admin/queries"
import { paymentState } from "@/features/registrations/schema"
import { routing } from "@/i18n/routing"
import { audit } from "@/lib/audit"
import { requireAdminApi } from "@/lib/auth/admin"
import { zonedParts } from "@/lib/format"

/**
 * CSV of a workshop's registrations (participant, member's contact, payment,
 * refund, consents), column titles in the page's language. Super admins only;
 * every export is written to the audit log. Safe against CSV / formula
 * injection (`toCsv`): names and phone numbers are typed by members.
 */
export async function GET(request: Request, ctx: RouteContext<"/[locale]/admin/workshops/[id]/registrations/export">) {
  const session = await requireAdminApi(request)
  if (!session) return new Response(null, { status: 401 })

  const { locale: requested, id } = await ctx.params
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 })
  const [course] = await db.select({ slug: courses.slug }).from(courses).where(eq(courses.id, id))
  if (!course) return new Response(null, { status: 404 })
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale
  const t = await getTranslations({ locale, namespace: "workshops.registrations" })

  const rows = await exportRegistrations(id)
  const day = (value: Date | null) => (value ? zonedParts(value).date : "")
  const yesNo = (value: boolean) => (value ? t("csv.yes") : t("csv.no"))
  const columns = [
    "participant",
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
  ] as const
  const table: Cell[][] = [
    columns.map((c) => t(`csv.${c}`)),
    ...rows.map((r) => [
      r.participantName,
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
    ]),
  ]

  await audit({
    adminId: session.admin.id,
    action: "registration.export",
    entity: "workshop",
    entityId: id,
    data: { rows: rows.length },
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
