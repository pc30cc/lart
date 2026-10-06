import { z } from "zod"

import { isoDateTime, kurus, localizedText, slug, uuid } from "@/components/admin/form/schemas"
import { isSafePath } from "@/lib/storage/shared"

/**
 * Workshop fields, shared by the form (client) and the actions (server).
 * Fields marked "contract" in `contractFields` appear in the instructor
 * contract: changing them after the contract was sent issues a new version.
 */

const count = (min: number, max: number) => z.number().int().min(min).max(max)

/** A storage path under one of our prefixes (never trust a path from the browser). */
const storagePath = (prefix: string) =>
  z.string().refine((p) => isSafePath(p) && p.startsWith(`${prefix}/`), { error: "common.validation.invalid" })

const sample = z.object({
  path: storagePath("courses"),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
})

export const feeTypes = ["per_participant", "fixed"] as const
export const ageGroups = ["adults", "children"] as const

const fields = z.object({
  title: localizedText({ required: ["fa", "tr", "en"], max: 120 }),
  slug: slug(),
  categoryId: z.uuid({ error: "workshops.validation.chooseCategory" }),
  instructorId: z.uuid({ error: "workshops.validation.chooseInstructor" }),
  startsAt: isoDateTime(),
  endsAt: isoDateTime(),
  registrationDeadline: isoDateTime(),
  decisionAt: isoDateTime(),
  venue: z.string().trim().min(1).max(300),
  ageGroup: z.enum(ageGroups),
  ageMin: count(1, 18).nullable(),
  ageMax: count(1, 18).nullable(),
  minCapacity: count(1, 500),
  maxCapacity: count(1, 500),
  price: kurus(),
  /** null = the default terms template. */
  termsTemplateId: z.uuid().nullable(),
  intro: localizedText({ max: 2000 }),
  includes: localizedText({ max: 1000 }),
  /** "Nothing needed": stored as bring = null. */
  bringNothing: z.boolean(),
  bring: localizedText({ max: 500 }),
  experienceRequired: z.boolean(),
  experienceNote: localizedText({ max: 300 }),
  notes: localizedText({ max: 2000 }),
  coverPath: storagePath("courses").nullable(),
  samples: z.array(sample).max(12),
  // Contract
  feeType: z.enum(feeTypes),
  feeAmount: kurus(),
  hasAdvance: z.boolean(),
  advanceAmount: kurus().nullable(),
})

type Fields = z.output<typeof fields>

/** Highest advance allowed: the fixed fee, or the per-participant fee for a full workshop. */
export function maxAdvance(v: Pick<Fields, "feeType" | "feeAmount" | "maxCapacity">): number {
  return v.feeType === "fixed" ? v.feeAmount : v.feeAmount * v.maxCapacity
}

function crossCheck(v: Fields, ctx: z.RefinementCtx) {
  const issue = (path: keyof Fields, message: string) => ctx.addIssue({ code: "custom", path: [path], message })
  if (v.endsAt <= v.startsAt) issue("endsAt", "common.validation.endAfterStart")
  if (v.maxCapacity < v.minCapacity) issue("maxCapacity", "workshops.validation.maxBelowMin")
  if (v.registrationDeadline > v.startsAt) issue("registrationDeadline", "workshops.validation.deadlineBeforeStart")
  if (v.decisionAt > v.startsAt) issue("decisionAt", "workshops.validation.decisionBeforeStart")
  if (v.ageGroup === "children") {
    if (v.ageMin === null) issue("ageMin", "common.validation.required")
    if (v.ageMax === null) issue("ageMax", "common.validation.required")
    if (v.ageMin !== null && v.ageMax !== null && v.ageMax < v.ageMin) issue("ageMax", "workshops.validation.ageRange")
  }
  if (v.hasAdvance) {
    if (!v.advanceAmount) issue("advanceAmount", "workshops.validation.advanceRequired")
    else if (v.advanceAmount > maxAdvance(v)) issue("advanceAmount", "workshops.validation.advanceTooBig")
  }
}

/** Create: the workshop must also start in the future. */
export const workshopSchema = fields.superRefine((v, ctx) => {
  crossCheck(v, ctx)
  if (v.startsAt.getTime() <= Date.now()) {
    ctx.addIssue({ code: "custom", path: ["startsAt"], message: "workshops.validation.startInFuture" })
  }
})

/** Edit form (client): the same checks, without "starts in the future" (past workshops stay editable). */
export const workshopEditSchema = fields.superRefine(crossCheck)
/** Edit action (server): the edit form plus the workshop id. */
export const workshopUpdateSchema = fields.extend({ id: uuid() }).superRefine(crossCheck)
export const workshopIdSchema = z.object({ id: uuid() })

export type WorkshopFormValues = z.input<typeof workshopSchema>
export type WorkshopInput = z.output<typeof workshopSchema>

/** Fields that appear in the instructor contract (README "Workshop fields", 🔗). */
export const contractCourseFields = [
  "title",
  "instructorId",
  "startsAt",
  "endsAt",
  "venue",
  "minCapacity",
  "maxCapacity",
  "decisionAt",
] as const

/** Course columns from validated form input (contract fee fields stay on the contract). */
export function courseValues(v: WorkshopInput) {
  const empty = (t: Record<string, string | undefined>) => Object.keys(t).length === 0
  return {
    title: v.title,
    slug: v.slug,
    categoryId: v.categoryId,
    instructorId: v.instructorId,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    registrationDeadline: v.registrationDeadline,
    decisionAt: v.decisionAt,
    venue: v.venue,
    ageMin: v.ageGroup === "children" ? v.ageMin : null,
    ageMax: v.ageGroup === "children" ? v.ageMax : null,
    minCapacity: v.minCapacity,
    maxCapacity: v.maxCapacity,
    price: v.price,
    termsTemplateId: v.termsTemplateId,
    intro: empty(v.intro) ? null : v.intro,
    includes: empty(v.includes) ? null : v.includes,
    bring: v.bringNothing || empty(v.bring) ? null : v.bring,
    experienceRequired: v.experienceRequired,
    experienceNote: v.experienceRequired && !empty(v.experienceNote) ? v.experienceNote : null,
    notes: empty(v.notes) ? null : v.notes,
    coverPath: v.coverPath,
  }
}

/** Contract columns from validated form input. */
export function feeValues(v: Pick<WorkshopInput, "feeType" | "feeAmount" | "hasAdvance" | "advanceAmount">) {
  return { feeType: v.feeType, feeAmount: v.feeAmount, advanceAmount: v.hasAdvance ? (v.advanceAmount ?? 0) : 0 }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export const workshopStatuses = ["awaiting_signature", "published", "confirmed", "cancelled", "closed"] as const
export type WorkshopStatus = (typeof workshopStatuses)[number]

/**
 * Cancelled, also after its books were closed: closing a cancelled workshop
 * keeps the status "cancelled" and sets `closedAt`. The `cancelledAt` check is
 * a fallback for older rows, closed as status "closed" with `cancelledAt` kept.
 */
export const isCancelled = (w: { status: WorkshopStatus; cancelledAt: Date | null }) =>
  w.status === "cancelled" || w.cancelledAt !== null

/** The status to show: a cancelled workshop stays "cancelled" after closing (also an older "closed" row with `cancelledAt`). */
export const displayStatus = (w: { status: WorkshopStatus; cancelledAt: Date | null }): WorkshopStatus =>
  isCancelled(w) ? "cancelled" : w.status

/**
 * Whether the contract terms can no longer change: the workshop is cancelled
 * or closed, or it has started after the go decision (its fee is settled from
 * that contract and the final number). Before the start, a confirmed workshop
 * can still get a new contract version; it keeps its go decision.
 */
export function contractLocked(
  w: { status: WorkshopStatus; startsAt: Date; finalParticipants: number | null },
  now: Date = new Date(),
): boolean {
  return w.status === "cancelled" || w.status === "closed" || (w.finalParticipants !== null && w.startsAt <= now)
}

// ─── Gallery ──────────────────────────────────────────────────────────────────

const galleryItem = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    path: storagePath("gallery"),
    originalPath: storagePath("originals").optional(),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
  }),
  z.object({ kind: z.literal("video"), path: storagePath("gallery") }),
])

export const gallerySchema = z.object({ id: uuid(), items: z.array(galleryItem).max(200) })
export type GalleryItemInput = z.output<typeof galleryItem>

// ─── List page ────────────────────────────────────────────────────────────────

export const workshopViews = [
  "upcoming",
  "awaiting_signature",
  "published",
  "confirmed",
  "cancelled",
  "closed",
  "all",
] as const
export type WorkshopView = (typeof workshopViews)[number]

export const workshopTable = {
  sort: ["startsAt", "title", "fill", "price"] as const,
  filters: { view: workshopViews },
}
