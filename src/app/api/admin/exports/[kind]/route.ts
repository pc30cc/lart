import { z } from "zod"

import { monthFileName } from "@/features/backup/backup"
import { expensesWorkbook, financeWorkbook, workshopWorkbook, monthWorkbook } from "@/features/backup/excel"
import { invoicesZip, safeName } from "@/features/backup/invoices"
import { csvDate } from "@/features/money/csv"
import { audit } from "@/lib/audit"
import { requireAdminApi } from "@/lib/auth/admin"
import { periodStart } from "@/lib/calendar"
import { zonedParts } from "@/lib/format"

const kinds = ["expenses", "finance", "workshop", "month", "invoices"] as const
type Kind = (typeof kinds)[number]

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const day = z.iso.date()

/**
 * Downloads of Settings → Backup, in Persian:
 *   expenses  every expense (Excel)
 *   finance   all the books: wallet, partners, workshops, expenses, entries (Excel)
 *   workshop  one workshop's books (?id=) (Excel)
 *   month     one Solar Hijri month's report (?m=YYYY-MM-DD, its first day) (Excel)
 *   invoices  every receipt and photo kept with an expense, in a folder per workshop,
 *             general expenses and furnishing (ZIP)
 * Super admins only; every download is written to the audit log.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/exports/[kind]">) {
  const session = await requireAdminApi(request)
  if (!session) return new Response(null, { status: 401 })

  const { kind } = await ctx.params
  if (!(kinds as readonly string[]).includes(kind)) return new Response(null, { status: 404 })
  const search = new URL(request.url).searchParams
  const today = csvDate(zonedParts(new Date()).date, "fa").replaceAll("/", "-")

  const made = await build(kind as Kind, search, today)
  if (!made) return new Response(null, { status: 404 })

  await audit({ adminId: session.admin.id, action: "backup.export", entity: "export", entityId: kind, data: made.data })
  return new Response(made.body, {
    headers: {
      "Content-Type": made.type,
      // An ASCII name for old browsers, the Persian one for the rest (browsers turn
      // the zero-width non-joiner of "هزینه‌ها" into "_" in a file name: a space instead).
      "Content-Disposition": `attachment; filename="${made.ascii}"; filename*=UTF-8''${encodeURIComponent(made.name.replaceAll("\u200c", " "))}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

type Made = { body: BodyInit; type: string; ascii: string; name: string; data?: Record<string, unknown> }

async function build(kind: Kind, search: URLSearchParams, today: string): Promise<Made | null> {
  switch (kind) {
    case "expenses":
      return { body: new Uint8Array(await expensesWorkbook()), type: XLSX, ascii: `limer-expenses-${today}.xlsx`, name: `هزینه‌ها - ${today}.xlsx` }
    case "finance":
      return { body: new Uint8Array(await financeWorkbook()), type: XLSX, ascii: `limer-finance-${today}.xlsx`, name: `گزارش کامل مالی - ${today}.xlsx` }
    case "workshop": {
      const id = z.uuid().safeParse(search.get("id"))
      if (!id.success) return null
      const w = await workshopWorkbook(id.data)
      if (!w) return null
      return { body: new Uint8Array(w.file), type: XLSX, ascii: `limer-workshop-${w.slug}.xlsx`, name: `ورکشاپ ${safeName(w.title, 60)} - ${today}.xlsx`, data: { workshop: id.data } }
    }
    case "month": {
      const m = day.safeParse(search.get("m"))
      // Only the first day of a Solar Hijri month.
      if (!m.success || periodStart(m.data, "month", "persian") !== m.data) return null
      const r = await monthWorkbook(m.data)
      return { body: new Uint8Array(r.file), type: XLSX, ascii: `${monthFileName(m.data)}.xlsx`, name: `گزارش مالی ${r.name}.xlsx`, data: { month: m.data } }
    }
    case "invoices":
      return { body: await invoicesZip(), type: "application/zip", ascii: `limer-invoices-${today}.zip`, name: `فاکتورها - ${today}.zip` }
  }
}
