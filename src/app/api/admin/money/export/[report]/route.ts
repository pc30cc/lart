import { hasLocale } from "next-intl"
import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { routing } from "@/i18n/routing"
import { audit } from "@/lib/audit"
import { requireAdminApi } from "@/lib/auth/admin"
import { lira, toCsv, type Cell } from "@/features/money/csv"
import type { TransactionKind } from "@/features/money/ledger"
import {
  instructorResults,
  ledgerExport,
  partnerStatement,
  profitAndLoss,
  workshopResults,
} from "@/features/money/reports"
import { accounts, parseReportParams, transactionKinds } from "@/features/money/schema"
import { localized, zonedParts } from "@/lib/format"

const reports = ["pnl", "workshops", "instructors", "partner", "transactions"] as const
type Translate = Awaited<ReturnType<typeof getTranslations>>

/**
 * CSV export of the money reports and the ledger. Super admins only; every
 * export is written to the audit log. Query: the same params as the reports
 * page (?from=&to=&group=&partner=) plus ?locale= for the column titles, and
 * for the ledger its filters (?kind=&account=&partner=&workshop=).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/money/export/[report]">) {
  const session = await requireAdminApi(request)
  if (!session) return new Response(null, { status: 401 })

  const { report } = await ctx.params
  if (!(reports as readonly string[]).includes(report)) return new Response(null, { status: 404 })
  const search = Object.fromEntries(new URL(request.url).searchParams)
  const params = parseReportParams(search)
  const locale = hasLocale(routing.locales, search.locale) ? search.locale : routing.defaultLocale
  const t = await getTranslations({ locale })

  const rows = await build(report as (typeof reports)[number], params, search, t, locale)
  if (!rows) return new Response(null, { status: 404 })

  await audit({
    adminId: session.admin.id,
    action: "money.export",
    entity: "report",
    entityId: report,
    data: { from: params.from, to: params.to, group: params.group, partner: params.partner },
  })
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}_${params.from}_${params.to}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

const kindLabel = (t: Translate, kind: TransactionKind, originalKind: TransactionKind | null) =>
  originalKind ? t("money.kinds.reversalOf", { kind: t(`money.kinds.${originalKind}`) }) : t(`money.kinds.${kind}`)

const ledgerFilters = z.object({
  kind: z.enum(transactionKinds).optional().catch(undefined),
  account: z.enum(accounts).optional().catch(undefined),
  partner: z.uuid().optional().catch(undefined),
  workshop: z.uuid().optional().catch(undefined),
})

async function build(
  report: (typeof reports)[number],
  params: ReturnType<typeof parseReportParams>,
  search: Record<string, string>,
  t: Translate,
  locale: string,
): Promise<Cell[][] | null> {
  const c = (key: string) => t(`money.columns.${key}`)
  const figures = ["revenue", "instructorFees", "courseExpenses", "generalExpenses", "net"] as const

  switch (report) {
    case "pnl": {
      const { periods, total } = await profitAndLoss(params)
      return [
        [c("period"), ...figures.map(c)],
        ...periods.map((p) => [p.period, ...figures.map((k) => lira(p[k]))]),
        [c("total"), ...figures.map((k) => lira(total[k]))],
      ]
    }
    case "workshops": {
      const { workshops, total } = await workshopResults(params)
      // The fee of a confirmed workshop not closed yet is estimated (included in instructorFees): its own column says how much.
      const cols = ["revenue", "instructorFees", "courseExpenses", "net", "estimatedFee"] as const
      return [
        [c("date"), c("workshop"), c("instructor"), c("status"), c("participants"), ...cols.map(c)],
        ...workshops.map((w) => [
          zonedParts(w.startsAt).date,
          localized(w.title, locale),
          localized(w.instructor, locale),
          w.status === "cancelled" && w.closed ? t("money.reports.cancelledClosed") : t(`workshops.status.${w.status}`),
          w.participants,
          ...cols.map((k) => lira(w[k])),
        ]),
        [c("total"), "", "", "", total.participants, ...cols.map((k) => lira(total[k]))],
      ]
    }
    case "instructors": {
      const { instructors, total } = await instructorResults(params)
      const cols = ["revenue", "instructorFees", "courseExpenses", "net", "estimatedFee"] as const
      return [
        [c("instructor"), c("workshops"), c("participants"), ...cols.map(c)],
        ...instructors.map((i) => [localized(i.instructor, locale), i.workshops, i.participants, ...cols.map((k) => lira(i[k]))]),
        [c("total"), total.workshops, total.participants, ...cols.map((k) => lira(total[k]))],
      ]
    }
    case "partner": {
      if (!params.partner) return null
      const statement = await partnerStatement(params.partner, params)
      if (!statement) return null
      return [
        [statement.partner.name],
        [c("date"), c("type"), c("description"), c("workshop"), c("amount"), c("balance")],
        [params.from, c("opening"), "", "", "", lira(statement.opening)],
        ...statement.movements.map((m) => [
          m.occurredOn,
          kindLabel(t, m.kind, m.originalKind),
          m.description,
          m.courseTitle ? localized(m.courseTitle, locale) : "",
          lira(m.amount),
          lira(m.balance),
        ]),
        [params.to, c("closing"), "", "", "", lira(statement.closing)],
      ]
    }
    case "transactions": {
      const lines = await ledgerExport(params, ledgerFilters.parse(search))
      return [
        [c("date"), c("entry"), c("type"), c("description"), c("workshop"), c("account"), c("partner"), c("debit"), c("credit")],
        ...lines.map((l) => [
          l.occurredOn,
          l.id,
          kindLabel(t, l.kind, l.originalKind),
          l.description,
          l.courseTitle ? localized(l.courseTitle, locale) : "",
          t(`money.accounts.${l.account}`),
          l.partnerName ?? "",
          l.amount > 0 ? lira(l.amount) : "",
          l.amount < 0 ? lira(-l.amount) : "",
        ]),
      ]
    }
  }
}
