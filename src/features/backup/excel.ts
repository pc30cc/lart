import "server-only"
import ExcelJS from "exceljs"

import { addPeriods, dayBefore } from "@/lib/calendar"
import { formatDate, formatDateTime, formatMonthYear, localized } from "@/lib/format"
import { getBrand } from "@/lib/settings"
import fa from "../../../messages/fa/money.json"
import {
  closedIn,
  expenseRows,
  journalRows,
  partnerRows,
  periodFigures,
  registrationRows,
  walletSummary,
  workshopHead,
  workshopRows,
  type ExpenseRow,
  type Range,
  type WorkshopRow,
} from "./data"

/**
 * The Excel exports of Settings → Backup, in Persian: right-to-left sheets,
 * Solar Hijri dates, amounts in lira (numbers a spreadsheet can add up),
 * a title block, a styled header, frozen and filterable, and a totals row.
 */

const CLAY = "FFA4562F"
const CLAY_SOFT = "FFF6ECE6"
const PAPER = "FFFBF8F4"
const INK = "FF2B2420"
const MUTED = "FF7A6F68"
const FONT = "Tahoma"
const LIRA = '#,##0.00 "₺";[Red]-#,##0.00 "₺"'

type Kind = "money" | "text" | "date" | "number" | "percent"
type Column<R> = { header: string; width: number; kind?: Kind; value: (row: R, index: number) => string | number | null; total?: boolean }

const day = (iso: string) => formatDate(`${iso}T09:00:00Z`, "fa", "short")
const lira = (kurus: number) => kurus / 100
const title = (text: Parameters<typeof localized>[0]) => localized(text, "fa")

function newBook(): ExcelJS.Workbook {
  const book = new ExcelJS.Workbook()
  book.creator = "Limer"
  book.created = new Date()
  return book
}

/**
 * A sheet with a title block (brand, report, period, when it was made) and,
 * when `columns` are given, a table of `rows` with a totals row.
 */
function sheet<R>(
  book: ExcelJS.Workbook,
  name: string,
  head: { brand: string; report: string; period?: string },
  columns: Column<R>[],
  rows: R[],
) {
  const ws = book.addWorksheet(name, {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 5, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    properties: { defaultRowHeight: 20 },
  })
  ws.columns = columns.map((c) => ({ width: c.width }))
  const span = Math.max(columns.length, 4)

  const line = (row: number, text: string, size: number, color: string, bold = false) => {
    ws.mergeCells(row, 1, row, span)
    const cell = ws.getCell(row, 1)
    cell.value = text
    cell.font = { name: FONT, size, bold, color: { argb: color } }
    cell.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" }
  }
  line(1, head.brand, 16, CLAY, true)
  line(2, head.report, 13, INK, true)
  line(3, [head.period, `تهیه‌شده: ${formatDateTime(new Date(), "fa", "medium")}`].filter(Boolean).join("  ·  "), 9, MUTED)
  ws.getRow(1).height = 26
  ws.getRow(2).height = 22

  const header = ws.getRow(5)
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLAY } }
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true, readingOrder: "rtl" }
    cell.border = { bottom: { style: "thin", color: { argb: CLAY } } }
  })
  header.height = 26

  rows.forEach((r, n) => {
    const row = ws.getRow(6 + n)
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      const v = c.value(r, n)
      cell.value = v
      cell.font = { name: FONT, size: 10, color: { argb: INK } }
      cell.alignment = { horizontal: c.kind === "money" || c.kind === "number" ? "left" : "right", vertical: "middle", readingOrder: "rtl", wrapText: c.kind === "text" }
      if (c.kind === "money") cell.numFmt = LIRA
      if (c.kind === "percent") cell.numFmt = "0%"
      if (n % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAPER } }
      cell.border = { bottom: { style: "hair", color: { argb: "FFE7DDD5" } } }
    })
  })

  if (columns.some((c) => c.total) && rows.length > 0) {
    const at = 6 + rows.length
    const row = ws.getRow(at)
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      const letter = ws.getColumn(i + 1).letter
      if (c.total) cell.value = { formula: `SUM(${letter}6:${letter}${at - 1})` }
      else if (i === 0) cell.value = "جمع"
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLAY_SOFT } }
      cell.border = { top: { style: "medium", color: { argb: CLAY } } }
      cell.alignment = { horizontal: c.total ? "left" : "right", readingOrder: "rtl" }
      if (c.kind === "money") cell.numFmt = LIRA
    })
    row.height = 24
  }
  if (rows.length > 0) ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rows.length, column: columns.length } }
  return ws
}

/** A two-column "label: amount" block (summaries), with optional bold rows and section headings. */
function summary(
  book: ExcelJS.Workbook,
  name: string,
  head: { brand: string; report: string; period?: string },
  items: ({ label: string; value: number | string; money?: boolean; strong?: boolean; note?: string } | { heading: string })[],
) {
  const ws = sheet<never>(book, name, head, [], [])
  ws.views = [{ rightToLeft: true, showGridLines: false }]
  ws.columns = [{ width: 42 }, { width: 22 }, { width: 60 }]
  let at = 5
  for (const item of items) {
    const row = ws.getRow(at++)
    if ("heading" in item) {
      at++
      const cell = row.getCell(1)
      ws.mergeCells(row.number, 1, row.number, 3)
      cell.value = item.heading
      cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLAY } }
      cell.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" }
      row.height = 22
      continue
    }
    const [label, value, note] = [row.getCell(1), row.getCell(2), row.getCell(3)]
    label.value = item.label
    value.value = item.value
    note.value = item.note ?? null
    const font = { name: FONT, size: 10, bold: Boolean(item.strong), color: { argb: INK } }
    label.font = font
    value.font = font
    note.font = { name: FONT, size: 9, color: { argb: MUTED } }
    label.alignment = { horizontal: "right", readingOrder: "rtl" }
    value.alignment = { horizontal: "left" }
    note.alignment = { horizontal: "right", readingOrder: "rtl", wrapText: true }
    if (item.money) value.numFmt = LIRA
    const border = { bottom: { style: "hair" as const, color: { argb: "FFE7DDD5" } } }
    label.border = value.border = note.border = item.strong ? { top: { style: "thin", color: { argb: CLAY } } } : border
    if (item.strong) label.fill = value.fill = note.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLAY_SOFT } }
  }
  return ws
}

// ─── Labels ──────────────────────────────────────────────────────────────────

const kindLabel = (kind: string, original?: string | null) =>
  kind === "reversal" && original ? `اصلاحیهٔ ${fa.kinds[original as keyof typeof fa.kinds] ?? original}` : (fa.kinds[kind as keyof typeof fa.kinds] ?? kind)
const accountLabel = (account: string) => fa.accounts[account as keyof typeof fa.accounts] ?? account
const expenseKind = (e: ExpenseRow) => (e.furnishing ? "اثاثیه" : e.courseId ? "هزینهٔ ورکشاپ" : "هزینهٔ عمومی")
const statusLabel: Record<string, string> = {
  awaiting_signature: "در انتظار امضای قرارداد",
  published: "منتشرشده",
  confirmed: "قطعی",
  cancelled: "لغوشده",
  closed: "بسته‌شده",
}
const registrationStatus: Record<string, string> = { pending: "در انتظار پرداخت", confirmed: "پرداخت‌شده", cancelled: "لغوشده" }
const methodLabel: Record<string, string> = { cash: "نقدی", transfer: "کارت‌به‌کارت / حواله", online: "آنلاین" }

// ─── Shared sheets ────────────────────────────────────────────────────────────

function expensesSheet(book: ExcelJS.Workbook, head: { brand: string; report: string; period?: string }, rows: ExpenseRow[]) {
  const live = rows.filter((r) => !r.reversed)
  sheet<ExpenseRow>(book, "هزینه‌ها", head, [
    { header: "ردیف", width: 7, kind: "number", value: (_, i) => i + 1 },
    { header: "تاریخ", width: 13, value: (r) => day(r.occurredOn) },
    { header: "نوع", width: 15, value: expenseKind },
    { header: "ورکشاپ", width: 28, kind: "text", value: (r) => (r.courseTitle ? title(r.courseTitle) : "—") },
    { header: "شرح", width: 34, kind: "text", value: (r) => r.description },
    { header: "پرداخت از", width: 17, value: (r) => (r.fromAdvance ? "پیش‌پرداخت مدرس" : "کیف پول مشترک") },
    { header: "مبلغ", width: 16, kind: "money", value: (r) => lira(r.amount), total: true },
    { header: "فیش", width: 8, kind: "number", value: (r) => r.files },
    { header: "ثبت‌کننده", width: 18, value: (r) => r.recordedBy ?? "" },
  ], live)
  const reversed = rows.filter((r) => r.reversed)
  if (reversed.length) {
    sheet<ExpenseRow>(book, "هزینه‌های برگشت‌خورده", { ...head, report: `${head.report} — برگشت‌خورده (در جمع حساب نشده‌اند)` }, [
      { header: "تاریخ", width: 13, value: (r) => day(r.occurredOn) },
      { header: "نوع", width: 15, value: expenseKind },
      { header: "شرح", width: 34, kind: "text", value: (r) => r.description },
      { header: "مبلغ", width: 16, kind: "money", value: (r) => lira(r.amount) },
    ], reversed)
  }
  return live
}

function journalSheet(book: ExcelJS.Workbook, head: { brand: string; report: string; period?: string }, rows: Awaited<ReturnType<typeof journalRows>>) {
  sheet(book, "دفتر روزنامه", head, [
    { header: "تاریخ", width: 13, value: (r) => day(r.occurredOn) },
    { header: "نوع تراکنش", width: 22, value: (r) => kindLabel(r.kind, r.originalKind) },
    { header: "شرح", width: 30, kind: "text", value: (r) => r.description },
    { header: "ورکشاپ", width: 24, kind: "text", value: (r) => (r.courseTitle ? title(r.courseTitle) : "") },
    { header: "حساب", width: 22, value: (r) => accountLabel(r.account) + (r.partnerName ? ` — ${r.partnerName}` : "") },
    { header: "بدهکار", width: 15, kind: "money", value: (r) => (r.amount > 0 ? lira(r.amount) : null), total: true },
    { header: "بستانکار", width: 15, kind: "money", value: (r) => (r.amount < 0 ? lira(-r.amount) : null), total: true },
    { header: "ثبت‌کننده", width: 16, value: (r) => r.recordedBy ?? "" },
  ], rows)
}

function workshopsSheet(book: ExcelJS.Workbook, head: { brand: string; report: string; period?: string }, rows: WorkshopRow[], name = "ورکشاپ‌ها") {
  sheet<WorkshopRow>(book, name, head, [
    { header: "ورکشاپ", width: 30, kind: "text", value: (r) => title(r.title) },
    { header: "تاریخ", width: 13, value: (r) => formatDate(r.startsAt, "fa", "short") },
    { header: "مدرس", width: 20, value: (r) => title(r.instructor) },
    { header: "وضعیت", width: 18, value: (r) => statusLabel[r.status] ?? r.status },
    { header: "شرکت‌کننده", width: 11, kind: "number", value: (r) => r.participants, total: true },
    { header: "درآمد", width: 15, kind: "money", value: (r) => lira(r.revenue), total: true },
    { header: "مواد و هزینه‌ها", width: 15, kind: "money", value: (r) => lira(r.courseExpenses), total: true },
    { header: "دستمزد مدرس", width: 15, kind: "money", value: (r) => lira(r.instructorFees), total: true },
    { header: "سود خالص", width: 15, kind: "money", value: (r) => lira(r.net), total: true },
    { header: "توضیح", width: 26, kind: "text", value: (r) => (r.projected ? "دستمزد مدرس پیش‌بینی‌شده (هنوز بسته نشده)" : r.closedAt ? `بسته‌شده ${formatDate(r.closedAt, "fa", "short")}` : "") },
  ], rows)
}

// ─── The exports ──────────────────────────────────────────────────────────────

const brandOf = async () => (await getBrand("fa")) || "Limer"
const periodText = (range?: Range) => (range ? `از ${day(range.from)} تا ${day(range.to)}` : "از ابتدا تا امروز")

/** Every expense (workshops, general, furnishing) and their totals by kind and by workshop. */
export async function expensesWorkbook(range?: Range): Promise<Buffer> {
  const book = newBook()
  const brand = await brandOf()
  const head = { brand, report: "گزارش هزینه‌ها", period: periodText(range) }
  const rows = await expenseRows(range)
  const live = rows.filter((r) => !r.reversed)
  const total = (f: (r: ExpenseRow) => boolean) => live.filter(f).reduce((s, r) => s + r.amount, 0)
  const byWorkshop = new Map<string, { name: string; amount: number }>()
  for (const r of live.filter((r) => r.courseId)) {
    const w = byWorkshop.get(r.courseId!) ?? { name: title(r.courseTitle!), amount: 0 }
    w.amount += r.amount
    byWorkshop.set(r.courseId!, w)
  }
  summary(book, "خلاصه", head, [
    { heading: "جمع هزینه‌ها" },
    { label: "هزینه‌های ورکشاپ‌ها", value: lira(total((r) => Boolean(r.courseId))), money: true, note: "مواد و هزینه‌های هر ورکشاپ؛ از درآمد همان ورکشاپ کم می‌شود" },
    { label: "هزینه‌های عمومی", value: lira(total((r) => !r.courseId && !r.furnishing)), money: true, note: "اجاره، سایت، تبلیغ و…؛ از سرمایه کم می‌شود" },
    { label: "اثاثیه", value: lira(total((r) => r.furnishing)), money: true, note: "وسایل و تجهیزات آتلیه؛ از سرمایه کم می‌شود" },
    { label: "جمع کل", value: lira(total(() => true)), money: true, strong: true },
    { label: "تعداد هزینه‌ها", value: live.length },
    ...(byWorkshop.size ? [{ heading: "به تفکیک ورکشاپ" }, ...[...byWorkshop.values()].map((w) => ({ label: w.name, value: lira(w.amount), money: true }))] : []),
  ])
  expensesSheet(book, head, rows)
  return Buffer.from(await book.xlsx.writeBuffer())
}

/** The whole picture: wallet and capital, partners, workshops, expenses and the journal. */
export async function financeWorkbook(): Promise<Buffer> {
  const book = newBook()
  const brand = await brandOf()
  const head = { brand, report: "گزارش کامل امور مالی", period: periodText() }
  const [w, partners, workshops, expenses, journal] = await Promise.all([walletSummary(), partnerRows(), workshopRows(), expenseRows(), journalRows()])
  summary(book, "خلاصه", head, [
    { heading: "کیف پول مشترک" },
    { label: "موجودی کیف پول", value: lira(w.wallet), money: true, strong: true, note: "پولی که همین حالا در کیف پول مشترک است" },
    { label: "سرمایهٔ واریزی شرکا", value: lira(w.putIn), money: true },
    { label: "هزینه‌های عمومی و اثاثیه", value: lira(-w.overhead), money: true },
    { label: "مانده سرمایه", value: lira(w.remaining), money: true, strong: true, note: "سرمایه منهای هزینه‌های کلی کسب‌وکار" },
    { label: "سود خالص ورکشاپ‌ها", value: lira(w.workshops), money: true, strong: true, note: "درآمد ورکشاپ‌ها منهای مواد و دستمزد مدرس" },
    { label: "پیش‌پرداخت و بدهی‌ها", value: lira(w.other), money: true, note: "پول در دست مدرس‌ها، یا دستمزد و بازپرداختی که هنوز پرداخت نشده" },
    { heading: "مدرس‌ها" },
    { label: "پیش‌پرداخت در دست مدرس‌ها", value: lira(w.advances), money: true },
    { label: "بدهی به مدرس‌ها", value: lira(w.owedToInstructors), money: true },
  ])
  sheet(book, "شرکا", head, [
    { header: "شریک", width: 22, value: (r) => r.name },
    { header: "سهم سود", width: 11, kind: "percent", value: (r) => r.shareBp / 10000 },
    { header: "واریز سرمایه", width: 16, kind: "money", value: (r) => lira(r.contributions), total: true },
    { header: "برداشت", width: 14, kind: "money", value: (r) => lira(r.withdrawals), total: true },
    { header: "سود ورکشاپ‌های بسته‌شده", width: 18, kind: "money", value: (r) => lira(r.profitShares), total: true },
    { header: "سرمایهٔ فعلی", width: 16, kind: "money", value: (r) => lira(r.capital), total: true },
    { header: "سهم از نتیجهٔ باز", width: 16, kind: "money", value: (r) => lira(r.openShare), total: true },
    { header: "اگر امروز تسویه شود", width: 18, kind: "money", value: (r) => lira(r.equity), total: true },
  ], partners)
  workshopsSheet(book, head, workshops)
  expensesSheet(book, head, expenses)
  journalSheet(book, head, journal)
  return Buffer.from(await book.xlsx.writeBuffer())
}

/** One workshop: its result, registrations and payments, expenses and every entry. Null when it does not exist. */
export async function workshopWorkbook(courseId: string): Promise<{ file: Buffer; slug: string; title: string } | null> {
  const w = await workshopHead(courseId)
  if (!w) return null
  const book = newBook()
  const brand = await brandOf()
  const head = { brand, report: `گزارش مالی ورکشاپ «${title(w.title)}»`, period: formatDate(w.startsAt, "fa", "long") }
  const [[result], regs, expenses, journal] = await Promise.all([workshopRows([courseId]), registrationRows(courseId), expenseRows(undefined, courseId), journalRows(undefined, courseId)])
  summary(book, "خلاصه", head, [
    { heading: "ورکشاپ" },
    { label: "وضعیت", value: statusLabel[w.status] ?? w.status },
    { label: "تاریخ برگزاری", value: formatDate(w.startsAt, "fa", "long") },
    { label: "مدرس", value: result ? title(result.instructor) : "" },
    { label: "شرکت‌کننده", value: result?.participants ?? 0 },
    { heading: "نتیجهٔ مالی" },
    { label: "درآمد (پرداخت هنرجوها منهای بازپرداخت)", value: lira(result?.revenue ?? 0), money: true },
    { label: "مواد و هزینه‌ها", value: lira(-(result?.courseExpenses ?? 0)), money: true },
    { label: "دستمزد مدرس", value: lira(-(result?.instructorFees ?? 0)), money: true, note: result?.projected ? "پیش‌بینی‌شده: ورکشاپ هنوز بسته نشده" : undefined },
    { label: "سود خالص", value: lira(result?.net ?? 0), money: true, strong: true, note: w.closedAt ? "بین شرکا تقسیم شده" : "پس از بستن ورکشاپ بین شرکا تقسیم می‌شود" },
  ])
  sheet(book, "ثبت‌نام‌ها", head, [
    { header: "ردیف", width: 7, kind: "number", value: (_, i) => i + 1 },
    { header: "شرکت‌کننده", width: 24, value: (r) => r.participant },
    { header: "وضعیت", width: 16, value: (r) => registrationStatus[r.status] ?? r.status },
    { header: "مبلغ", width: 14, kind: "money", value: (r) => (r.status === "cancelled" && !r.paidAt ? 0 : lira(r.amount)), total: true },
    { header: "روش پرداخت", width: 18, value: (r) => (r.method ? (methodLabel[r.method] ?? r.method) : "") },
    { header: "تاریخ پرداخت", width: 14, value: (r) => (r.paidAt ? formatDate(r.paidAt, "fa", "short") : "") },
    { header: "بازپرداخت", width: 14, kind: "money", value: (r) => (r.refundAmount ? lira(r.refundAmount) : null), total: true },
    { header: "تاریخ بازپرداخت", width: 14, value: (r) => (r.refundedAt ? formatDate(r.refundedAt, "fa", "short") : r.refundAmount ? "هنوز پرداخت نشده" : "") },
  ], regs)
  expensesSheet(book, head, expenses)
  journalSheet(book, head, journal)
  return { file: Buffer.from(await book.xlsx.writeBuffer()), slug: w.slug, title: title(w.title) }
}

/** A Solar Hijri month: "YYYY-MM-DD" of its first day → the range and its name ("مهر ۱۴۰۵"). */
export function monthRange(first: string): { range: Range; name: string } {
  const next = addPeriods(first, 1, "month", "persian")
  return { range: { from: first, to: dayBefore(next) }, name: formatMonthYear(`${first}T09:00:00Z`, "fa") }
}

/** One month's books: income and costs, workshops closed in it, its expenses and entries. */
export async function monthWorkbook(first: string): Promise<{ file: Buffer; name: string }> {
  const { range, name } = monthRange(first)
  const book = newBook()
  const brand = await brandOf()
  const head = { brand, report: `گزارش مالی ماه ${name}`, period: periodText(range) }
  const [p, closed, expenses, journal, w] = await Promise.all([periodFigures(range), closedIn(range), expenseRows(range), journalRows(range), walletSummary()])
  const workshops = closed.length ? await workshopRows(closed) : []
  summary(book, "خلاصهٔ ماه", head, [
    { heading: "درآمد و هزینهٔ این ماه" },
    { label: "درآمد ورکشاپ‌ها", value: lira(p.revenue), money: true },
    { label: "مواد و هزینه‌های ورکشاپ‌ها", value: lira(-p.courseExpenses), money: true },
    { label: "دستمزد مدرس‌ها", value: lira(-p.instructorFees), money: true, note: "دستمزد هر ورکشاپ در روز بستن آن حساب می‌شود" },
    { label: "هزینه‌های عمومی و اثاثیه", value: lira(-p.generalExpenses), money: true, note: p.furnishing ? `شامل ${(p.furnishing / 100).toLocaleString("fa-IR")} لیر اثاثیه` : undefined },
    { label: "نتیجهٔ ماه", value: lira(p.net), money: true, strong: true },
    { heading: "گردش کیف پول در این ماه" },
    { label: "پول ورودی", value: lira(p.walletIn), money: true, note: p.contributions ? `شامل ${(p.contributions / 100).toLocaleString("fa-IR")} لیر واریز سرمایه` : undefined },
    { label: "پول خروجی", value: lira(-p.walletOut), money: true },
    { heading: "وضعیت امروز" },
    { label: "موجودی کیف پول", value: lira(w.wallet), money: true, strong: true },
    { label: "مانده سرمایه", value: lira(w.remaining), money: true },
    { label: "سود خالص ورکشاپ‌ها (تا امروز)", value: lira(w.workshops), money: true },
  ])
  workshopsSheet(book, head, workshops, "ورکشاپ‌های بسته‌شده")
  expensesSheet(book, head, expenses)
  journalSheet(book, head, journal)
  return { file: Buffer.from(await book.xlsx.writeBuffer()), name }
}

export type { WorkshopRow }
