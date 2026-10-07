/**
 * Registration rules shared by the site's pages (client) and the actions
 * (server): the form schemas, the registration window of a workshop, payment
 * and refund states, and the cancel preview. No server-only imports.
 */
import { z } from "zod"

import { uuid } from "@/components/admin/form/schemas"
import { normalizePhone, personName } from "@/features/accounts/schema"
import { locales } from "@/i18n/routing"
import { refundAmount, refundPercent, type RefundPercent } from "./refund-policy"

/** Active registrations (they hold a seat): registered, not paid yet ("pending") and paid ("confirmed"). */
export const activeStatuses = ["pending", "confirmed"] as const
export type RegistrationStatus = "pending" | "confirmed" | "cancelled"

/** Places one member may hold in one workshop (e.g. a parent with their children). */
export const MAX_ACTIVE_PER_MEMBER = 5

/** "  Deniz   Yılmaz " → "Deniz Yılmaz". */
const cleanName = (value: string) => value.replace(/\s+/g, " ").trim()

/** Case-folded for comparing names, Turkish-aware: "YILMAZ", "Yılmaz" and "yilmaz" are the same. */
const foldName = (value: string) =>
  cleanName(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/\u0307/g, "") // "İ".toLowerCase() is "i" + a combining dot

/** The same person for the "already registered" check: spacing, case and Unicode forms ignored. */
export const sameParticipant = (a: string, b: string) => foldName(a) === foldName(b)

const participantName = z.string().max(200).transform(cleanName).pipe(z.string().min(2).max(80))

/**
 * Register for a workshop. `termsSha256` is the SHA-256 of the terms text the
 * page showed (in `locale`); the server rebuilds the text and refuses when it
 * changed in between, so the stored hash is always of the text that was read.
 */
export const registerSchema = z.object({
  courseId: uuid(),
  locale: z.enum(locales),
  participantName,
  termsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  acceptTerms: z.literal(true, { error: "registration.register.errors.acceptTerms" }),
  photoConsent: z.boolean(),
  videoConsent: z.boolean(),
})
export type RegisterValues = z.input<typeof registerSchema>

/** One of the member's own registrations (cancel). */
export const registrationIdSchema = z.object({ id: uuid() })

/**
 * "My details" on the My workshops page. The language is the language of the
 * member's emails. The name follows the sign-up rule (`personName`: no link,
 * email address or phone number), as it is the greeting of those emails.
 */
export const profileSchema = z.object({
  name: personName(),
  phone: z
    .string()
    .max(40)
    .optional()
    .transform((v) => normalizePhone(v ?? ""))
    .refine((v) => v === "" || /^\+?\d{7,15}$/.test(v), { error: "account.signup.errors.phone" }),
  locale: z.enum(locales),
})
export type ProfileValues = z.input<typeof profileSchema>

/**
 * A workshop's online payment link (`courses.payment_url`), only when it is a
 * plain https link (no user name or password): anything else is never shown
 * or emailed. The same rule as `paymentUrl` of the registration_received email.
 */
export function safePaymentUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".")) return url.href
  } catch {
    // not a link
  }
  return undefined
}

/** The ways to pay a workshop, in the order they are shown. */
export type PaymentWayName = "cash" | "transfer" | "online"

/**
 * The ways to pay that are switched on and usable for a workshop (the same
 * rule as `paymentWays` in emails/payment): cash; a bank transfer with an
 * IBAN; online payment when the workshop has a safe payment link.
 */
export function paymentWayNames(
  payment: { cash: boolean; transfer: { enabled: boolean; iban: string }; online: { enabled: boolean } },
  paymentUrl: string | null | undefined,
): PaymentWayName[] {
  return [
    ...(payment.cash ? (["cash"] as const) : []),
    ...(payment.transfer.enabled && payment.transfer.iban ? (["transfer"] as const) : []),
    ...(payment.online.enabled && safePaymentUrl(paymentUrl) ? (["online"] as const) : []),
  ]
}

/** "TR330006100519786457841326" → "TR33 0006 1005 1978 6457 8413 26". */
export const formatIban = (iban: string) => iban.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ")

// ─── Registration window ──────────────────────────────────────────────────────

/**
 * The places a workshop has. Before the go decision, its maximum capacity.
 * After it, the number fixed then (`final_participants`, the number the
 * instructor's per-participant fee is paid on): a place that is cancelled can
 * be taken again, but more people than that only come after the instructor
 * agreed (contract 5.2) and an admin raised the number. Never above the maximum.
 */
export function seatLimit(course: { maxCapacity: number; finalParticipants: number | null }): number {
  return course.finalParticipants === null ? course.maxCapacity : Math.min(course.maxCapacity, course.finalParticipants)
}

/**
 * Whether a workshop takes registrations right now, and if not, why:
 * - open: published or confirmed, before the deadline, seats left (after the
 *   go decision, only up to its final number: `seatLimit`),
 * - full: no seats left, closed: the registration deadline has passed,
 * - started: it has begun, past: it is over (or closed), cancelled,
 * - paused: waiting for a new contract signature after a change.
 */
export type RegistrationWindow = "open" | "full" | "closed" | "started" | "past" | "cancelled" | "paused"

export type WindowInput = {
  status: "awaiting_signature" | "published" | "confirmed" | "cancelled" | "closed"
  cancelledAt?: Date | null
  startsAt: Date
  endsAt: Date
  registrationDeadline: Date
  seatsLeft: number
}

export function registrationWindow(course: WindowInput, now: Date = new Date()): RegistrationWindow {
  if (course.status === "cancelled" || course.cancelledAt) return "cancelled"
  if (course.status === "closed" || course.endsAt <= now) return "past"
  if (course.startsAt <= now) return "started"
  if (course.status === "awaiting_signature") return "paused"
  if (course.registrationDeadline <= now) return "closed"
  if (course.seatsLeft <= 0) return "full"
  return "open"
}

// ─── Payment and refund state of one registration ─────────────────────────────

/**
 * What a member sees: "unpaid" (registered, not paid yet), "paid", "free" (a
 * workshop without a price: registered, nothing to pay) or "cancelled".
 */
export type PaymentState = "unpaid" | "paid" | "free" | "cancelled"

export function paymentState(r: { status: RegistrationStatus; amount: number }): PaymentState {
  if (r.status === "cancelled") return "cancelled"
  if (r.status === "pending") return "unpaid"
  return r.amount > 0 ? "paid" : "free"
}

/** A cancelled registration's refund: none owed, owed ("on its way") or paid back. */
export type RefundState = "none" | "due" | "sent"

export function refundState(r: { refundAmount: number | null; refundedAt: Date | null }): RefundState {
  if (r.refundedAt) return "sent"
  return r.refundAmount && r.refundAmount > 0 ? "due" : "none"
}

/**
 * What cancelling now would mean: the amount paid (0 when not paid yet, or a
 * free workshop), the refund band of the terms and the refund in kuruş.
 */
export type CancelPreview = { paid: number; percent: RefundPercent; refund: number }

export function cancelPreview(
  r: { status: RegistrationStatus; amount: number },
  startsAt: Date,
  now: Date = new Date(),
): CancelPreview {
  const paid = r.status === "confirmed" ? r.amount : 0
  return { paid, percent: refundPercent(startsAt, now), refund: paid > 0 ? refundAmount(paid, startsAt, now) : 0 }
}

/** A member may cancel an active registration until the workshop starts (unless the workshop was cancelled or closed). */
export function canCancel(
  r: { status: RegistrationStatus },
  course: { status: WindowInput["status"]; startsAt: Date; closedAt?: Date | null },
  now: Date = new Date(),
): boolean {
  return (
    r.status !== "cancelled" &&
    course.status !== "cancelled" &&
    course.status !== "closed" &&
    !course.closedAt &&
    now < course.startsAt
  )
}
