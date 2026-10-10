import { z } from "zod"

import { uuid } from "@/components/admin/form/schemas"
import { periodEnd, periodStart } from "@/lib/calendar"
import { zonedParts, type CalendarSystem } from "@/lib/format"

/**
 * Money forms and actions: Zod schemas shared by the client (instant feedback)
 * and the server actions (the real check). Amounts are integer kuruş.
 */

export const transactionKinds = [
  "capital_contribution",
  "capital_withdrawal",
  "expense",
  "registration_payment",
  "registration_refund",
  "instructor_advance",
  "instructor_payment",
  "course_settlement",
  "course_close",
  "reversal",
] as const
export const accounts = [
  "wallet",
  "instructor_advance",
  "instructor_payable",
  "partner_capital",
  "revenue",
  "instructor_fees",
  "course_expenses",
  "general_expenses",
] as const

const MAX_KURUS = 100_000_000_00

/** A real calendar date "YYYY-MM-DD" (rejects 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** A positive amount in kuruş from <MoneyInput>. */
const amount = z
  .number()
  .int()
  .min(1, { error: "money.validation.amountPositive" })
  .max(MAX_KURUS, { error: "money.validation.amountTooBig" })

/** A calendar date "YYYY-MM-DD", not in the future (Istanbul time). */
export const entryDate = () =>
  z
    .string()
    .refine((v) => isIsoDate(v) && v >= "2000-01-01", { error: "money.validation.date" })
    .refine((v) => v <= zonedParts(new Date()).date, { error: "money.validation.notInFuture" })

const note = z.string().trim().max(200)

/** Capital put in by every partner: `amount` is each partner's part (the same for all). */
export const contributionSchema = z.object({
  amount,
  occurredOn: entryDate(),
  note,
})
export type ContributionValues = z.input<typeof contributionSchema>

/** One partner takes money out (only while Settings → Money allows withdrawals). */
export const withdrawalSchema = z.object({
  partnerId: z.uuid({ error: "money.validation.choosePartner" }),
  amount,
  occurredOn: entryDate(),
  note,
})
export type WithdrawalValues = z.input<typeof withdrawalSchema>

/** Files kept with one expense, at most. */
export const MAX_EXPENSE_FILES = 10

/** A receipt (photo or PDF) or a photo of what was bought, uploaded with purpose "receipt". */
export const expenseFileSchema = z.object({
  path: z.string().regex(/^receipts\/[A-Za-z0-9_-]{1,64}\.(webp|pdf)$/),
  role: z.enum(["receipt", "photo"]),
})
export type ExpenseFile = z.infer<typeof expenseFileSchema>

export const expenseSchema = z
  .object({
    /** null: a general expense of the business. */
    courseId: z.uuid().nullable(),
    category: z.string().trim().min(1).max(100),
    amount,
    occurredOn: entryDate(),
    /** "wallet", or "advance": spent by the instructor out of the advance (workshop expenses only). */
    source: z.enum(["wallet", "advance"], { error: "money.validation.chooseSource" }),
    /** Furniture or equipment for the studio: a general expense, from the wallet. */
    furnishing: z.boolean().default(false),
    files: z.array(expenseFileSchema).max(MAX_EXPENSE_FILES).default([]),
  })
  .refine((v) => v.source !== "advance" || v.courseId, { path: ["source"], error: "money.validation.chooseSource" })
  .refine((v) => !v.furnishing || (v.courseId === null && v.source === "wallet"), { path: ["furnishing"] })
  // Photos of the thing bought belong to furnishing; every expense can keep receipts.
  .refine((v) => v.furnishing || v.files.every((f) => f.role === "receipt"), { path: ["files"] })
  .refine((v) => new Set(v.files.map((f) => f.path)).size === v.files.length, { path: ["files"] })
export type ExpenseValues = z.input<typeof expenseSchema>

export const advanceSchema = z.object({
  courseId: uuid(),
  direction: z.enum(["paid", "returned"]),
  amount,
  occurredOn: entryDate(),
  note,
})
export type AdvanceValues = z.input<typeof advanceSchema>

export const instructorPaymentSchema = z.object({
  courseId: uuid(),
  amount,
  occurredOn: entryDate(),
  note,
})
export type InstructorPaymentValues = z.input<typeof instructorPaymentSchema>

/** Close a workshop. The figures the admin saw (result, settlement, split): refused if any changed meanwhile. */
export const closeSchema = z.object({
  courseId: uuid(),
  revenue: z.number().int(),
  instructorFee: z.number().int(),
  expenses: z.number().int(),
  owedToInstructor: z.number().int(),
  partners: z.array(z.object({ adminId: z.uuid(), shareBp: z.number().int(), amount: z.number().int() })).max(3),
})

export const reverseSchema = z.object({ id: uuid() })

// ─── Lists and reports (URL params) ───────────────────────────────────────────

export const transactionTable = {
  sort: ["occurredOn", "amount"] as const,
  filters: { kind: transactionKinds, account: accounts },
}

export const reportKinds = ["pnl", "workshops", "instructors", "partner"] as const
export type ReportKind = (typeof reportKinds)[number]
export const periodGroups = ["month", "quarter", "year"] as const
export type PeriodGroup = (typeof periodGroups)[number]

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)

/**
 * A date range from the URL (?from=&to=), defaulting to this year in the
 * viewer's calendar (Persian: from Nowruz, 1 Farvardin). Never throws.
 */
export function parseRange(searchParams: Record<string, unknown>, now: Date = new Date(), calendar: CalendarSystem = "gregory") {
  const today = zonedParts(now).date
  const [f, t] = [first(searchParams.from), first(searchParams.to)]
  let from = isIsoDate(f) ? f : periodStart(today, "year", calendar)
  let to = isIsoDate(t) ? t : periodEnd(today, "year", calendar)
  if (from > to) [from, to] = [to, from]
  return { from, to }
}

/** Report page params: which report, the range, the grouping and the partner. Never throws. */
export function parseReportParams(searchParams: Record<string, unknown>, now: Date = new Date(), calendar: CalendarSystem = "gregory") {
  const report = first(searchParams.report)
  const group = first(searchParams.group)
  const partner = first(searchParams.partner)
  return {
    report: (reportKinds as readonly unknown[]).includes(report) ? (report as ReportKind) : "pnl",
    group: (periodGroups as readonly unknown[]).includes(group) ? (group as PeriodGroup) : "month",
    partner: z.uuid().safeParse(partner).success ? (partner as string) : null,
    ...parseRange(searchParams, now, calendar),
  }
}
export type ReportParams = ReturnType<typeof parseReportParams>
