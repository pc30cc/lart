import "server-only"
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import { db } from "@/db"
import {
  contracts,
  courses,
  expenseFiles,
  instructors,
  ledgerLines,
  ledgerTransactions,
  registrations,
  type Locale,
} from "@/db/schema"
import { renderContract } from "@/features/contracts/render"
import { dayCount } from "@/features/money/closing"
import { checkSignedText, recordedSignatureHashes, type SignedTextCheck } from "@/features/contracts/signed-text"
import { maskIdNumber } from "@/features/instructors/schema"
import { requireInstructor } from "@/lib/auth/instructor"
import { decrypt, sha256 } from "@/lib/crypto"
import { errorForLog } from "@/lib/errors"
import { getStorage, publicUrls } from "@/lib/storage"
import { workshopEarnings } from "./earnings"

/**
 * Reads of the instructor panel. Each one starts with `requireInstructor()`
 * and only ever returns the signed-in instructor's own contracts, workshops,
 * earnings and profile: an id from the URL that belongs to someone else reads
 * as "not found". Participants are shown by name and photo / video consent
 * only (contract 8.1): never their contact details or payment status.
 */

const isId = (id: string) => z.uuid().safeParse(id).success
/** `courses.id`, qualified by hand for the correlated subqueries below (see docs: Drizzle gotcha). */
const courseId = sql`${courses}.${sql.identifier("id")}`
/**
 * Seats taken: everyone registered, paid or not yet (not cancelled). Also the
 * participant number before the go decision fixes it (the go decision counts
 * the same way).
 */
const seatsTaken = sql<number>`(select count(*) from ${registrations} r where r.course_id = ${courseId} and r.status in ('pending', 'confirmed'))`.mapWith(Number)

const workshopCard = {
  id: courses.id,
  title: courses.title,
  venue: courses.venue,
  startsAt: courses.startsAt,
  days: courses.days,
  endsAt: courses.endsAt,
  status: courses.status,
  cancelledAt: courses.cancelledAt,
  minCapacity: courses.minCapacity,
  maxCapacity: courses.maxCapacity,
  registered: seatsTaken,
}

// ─── Contracts ────────────────────────────────────────────────────────────────

/** Contracts waiting for this instructor's signature (their workshop awaits it), soonest workshop first. */
export async function listContractsToSign() {
  const { instructor } = await requireInstructor()
  return db
    .select({
      id: contracts.id,
      version: contracts.version,
      sentAt: contracts.sentAt,
      title: courses.title,
      startsAt: courses.startsAt,
      days: courses.days,
      endsAt: courses.endsAt,
    })
    .from(contracts)
    .innerJoin(courses, eq(courses.id, contracts.courseId))
    .where(
      and(
        eq(contracts.instructorId, instructor.id),
        eq(contracts.status, "sent"),
        eq(courses.status, "awaiting_signature"),
      ),
    )
    .orderBy(asc(courses.startsAt))
}

/** Every contract version sent to this instructor, newest first (no texts). */
export async function listMyContracts() {
  const { instructor } = await requireInstructor()
  const rows = await db
    .select({
      id: contracts.id,
      version: contracts.version,
      status: contracts.status,
      sentAt: contracts.sentAt,
      signedAt: contracts.signedAt,
      title: courses.title,
      startsAt: courses.startsAt,
      days: courses.days,
      courseStatus: courses.status,
    })
    .from(contracts)
    .innerJoin(courses, eq(courses.id, contracts.courseId))
    .where(eq(contracts.instructorId, instructor.id))
    .orderBy(desc(contracts.sentAt), desc(contracts.version))
  return rows.map(({ courseStatus, ...row }) => ({ ...row, state: contractState(row.status, courseStatus) }))
}

/** A contract in plain words: to sign, signed, replaced by a newer version, or no longer signable. */
export type ContractState = "toSign" | "signed" | "replaced" | "closed"
const contractState = (status: "sent" | "signed" | "void", courseStatus: string): ContractState =>
  status === "signed" ? "signed" : status === "void" ? "replaced" : courseStatus === "awaiting_signature" ? "toSign" : "closed"

export type MyContract = NonNullable<Awaited<ReturnType<typeof getMyContract>>>

/**
 * One of this instructor's contracts with the text to show: the exact signed
 * text once signed (decrypted here, checked against its SHA-256 and the audit
 * log: `check`), else the text as it would be signed now, in `locale`, with
 * its SHA-256 for the sign form. Null when it is not theirs (or no such id).
 */
export async function getMyContract(id: string, locale: Locale) {
  const { instructor } = await requireInstructor()
  if (!isId(id)) return null
  const [row] = await db
    .select({
      id: contracts.id,
      version: contracts.version,
      status: contracts.status,
      sentAt: contracts.sentAt,
      signedAt: contracts.signedAt,
      signedName: contracts.signedName,
      signedLocale: contracts.signedLocale,
      signedText: contracts.signedText,
      signedTextSha256: contracts.signedTextSha256,
      courseId: courses.id,
      title: courses.title,
      startsAt: courses.startsAt,
      days: courses.days,
      endsAt: courses.endsAt,
      courseStatus: courses.status,
      cancelledAt: courses.cancelledAt,
      officialName: instructors.officialName,
    })
    .from(contracts)
    .innerJoin(courses, eq(courses.id, contracts.courseId))
    .innerJoin(instructors, eq(instructors.id, contracts.instructorId))
    .where(and(eq(contracts.id, id), eq(contracts.instructorId, instructor.id)))
    .limit(1)
  if (!row) return null

  const state = contractState(row.status, row.courseStatus)
  let doc: { text: string | null; locale: Locale; check: SignedTextCheck | null } | null = null
  if (row.signedText) {
    const signedLocale = (["fa", "tr", "en"] as const).find((l) => l === row.signedLocale) ?? locale
    const { text, check } = checkSignedText(row.signedText, row.signedTextSha256, await recordedSignatureHashes(row.id))
    doc = { text, locale: signedLocale, check }
  } else if (state === "toSign") {
    doc = { text: await renderContract(row.id, locale), locale, check: null }
  }

  // A replaced version points to the one that took its place (when it is this instructor's).
  const [newer] =
    state === "replaced"
      ? await db
          .select({ id: contracts.id })
          .from(contracts)
          .where(
            and(eq(contracts.courseId, row.courseId), eq(contracts.instructorId, instructor.id), ne(contracts.status, "void")),
          )
          .limit(1)
      : []

  return {
    id: row.id,
    version: row.version,
    state,
    sentAt: row.sentAt,
    signedAt: row.signedAt,
    signedName: row.signedName,
    course: {
      id: row.courseId,
      title: row.title,
      startsAt: row.startsAt,
      days: row.days,
      endsAt: row.endsAt,
      status: row.courseStatus,
      cancelledAt: row.cancelledAt,
    },
    doc,
    /** For the sign form: the fingerprint of the text shown and the name to type. */
    sign:
      state === "toSign" && doc?.text
        ? { textSha256: sha256(doc.text), officialName: row.officialName }
        : null,
    newerId: newer?.id ?? null,
  }
}

// ─── Workshops ────────────────────────────────────────────────────────────────

export type WorkshopCard = Awaited<ReturnType<typeof listMyWorkshops>>["upcoming"][number]

/** This instructor's workshops: upcoming (not ended yet, soonest first) and past (latest first). */
export async function listMyWorkshops(now: Date = new Date()) {
  const { instructor } = await requireInstructor()
  const rows = await db
    .select(workshopCard)
    .from(courses)
    .where(eq(courses.instructorId, instructor.id))
    .orderBy(asc(courses.startsAt), asc(courses.id))
  return { upcoming: rows.filter((r) => r.endsAt > now), past: rows.filter((r) => r.endsAt <= now).reverse() }
}

export type MyWorkshop = NonNullable<Awaited<ReturnType<typeof getMyWorkshop>>>

/**
 * One of this instructor's workshops with its participants: names and photo /
 * video consent of every registration that holds a seat. Null when it is not theirs.
 */
export async function getMyWorkshop(id: string) {
  const { instructor } = await requireInstructor()
  if (!isId(id)) return null
  const [workshop] = await db
    .select({
      ...workshopCard,
      ageMin: courses.ageMin,
      ageMax: courses.ageMax,
      registrationDeadline: courses.registrationDeadline,
      decisionAt: courses.decisionAt,
      finalParticipants: courses.finalParticipants,
    })
    .from(courses)
    .where(and(eq(courses.id, id), eq(courses.instructorId, instructor.id)))
    .limit(1)
  if (!workshop) return null

  const participants = await db
    .select({
      name: registrations.participantName,
      photo: registrations.photoConsent,
      video: registrations.videoConsent,
    })
    .from(registrations)
    .where(and(eq(registrations.courseId, id), ne(registrations.status, "cancelled")))
    .orderBy(asc(registrations.createdAt), asc(registrations.id))
  const [contract] = await db
    .select({ id: contracts.id, status: contracts.status })
    .from(contracts)
    .where(and(eq(contracts.courseId, id), eq(contracts.instructorId, instructor.id), ne(contracts.status, "void")))
    .limit(1)
  return { ...workshop, participants, contract: contract ?? null }
}

// ─── Earnings ─────────────────────────────────────────────────────────────────

export type WorkshopEarnings = Awaited<ReturnType<typeof getMyEarnings>>["workshops"][number]

/**
 * Per workshop with a contract: the agreed fee, the advance, what was received
 * and what is still owed (`workshopEarnings`), newest first, and the totals.
 * Cancelled workshops are listed only when money moved (an advance to return).
 */
export async function getMyEarnings() {
  const { instructor } = await requireInstructor()
  // The workshop's live contract (newest version that is not void), this instructor's only.
  const live = db
    .selectDistinctOn([contracts.courseId], {
      courseId: contracts.courseId,
      status: contracts.status,
      feeType: contracts.feeType,
      feeAmount: contracts.feeAmount,
      feeDays: contracts.feeDays,
      advanceAmount: contracts.advanceAmount,
    })
    .from(contracts)
    .where(and(eq(contracts.instructorId, instructor.id), ne(contracts.status, "void")))
    .orderBy(contracts.courseId, desc(contracts.version))
    .as("live")
  const rows = await db
    .select({
      id: courses.id,
      title: courses.title,
      startsAt: courses.startsAt,
      days: courses.days,
      endsAt: courses.endsAt,
      status: courses.status,
      cancelledAt: courses.cancelledAt,
      closedAt: courses.closedAt,
      closedTotals: courses.closedTotals,
      finalParticipants: courses.finalParticipants,
      registered: seatsTaken,
      contractStatus: live.status,
      feeType: live.feeType,
      feeAmount: live.feeAmount,
      feeDays: live.feeDays,
      advanceAmount: live.advanceAmount,
    })
    .from(courses)
    .innerJoin(live, eq(live.courseId, courses.id))
    .where(eq(courses.instructorId, instructor.id))
    .orderBy(desc(courses.startsAt), asc(courses.id))
  const [moved, paid] = await Promise.all([
    instructorMoney(instructor.id, rows.map((r) => r.id)),
    instructorPayments(instructor.id, rows.map((r) => r.id)),
  ])

  const workshops = rows.flatMap((r) => {
    const money = moved.get(r.id) ?? { advancePaid: 0, advanceForCosts: 0, payments: 0 }
    const cancelled = r.status === "cancelled" || r.cancelledAt !== null
    if (cancelled && !money.advancePaid && !money.payments) return []
    const closed = r.closedAt !== null || r.status === "closed"
    const participants = r.closedTotals?.participants ?? r.finalParticipants ?? r.registered
    const figures = workshopEarnings({
      cancelled,
      closedFee: closed ? (r.closedTotals?.instructorFee ?? null) : null,
      contract: { feeType: r.feeType, feeAmount: r.feeAmount, feeDays: r.feeDays, days: dayCount(r) },
      participants,
      ...money,
    })
    return [
      {
        id: r.id,
        title: r.title,
        startsAt: r.startsAt,
        days: r.days,
        endsAt: r.endsAt,
        status: r.status,
        cancelledAt: r.cancelledAt,
        signed: r.contractStatus === "signed",
        closed,
        feeType: r.feeType,
        feeAmount: r.feeAmount,
        /** A fixed fee: the days it is paid for now, and those the contract was issued for. */
        dayCount: dayCount(r),
        feeDays: r.feeDays,
        participants,
        /** The fee still depends on the number of participants (fixed at the go decision). */
        estimate: !closed && !cancelled && r.feeType === "per_participant" && r.finalParticipants === null,
        advancePaid: money.advancePaid,
        advanceForCosts: money.advanceForCosts,
        /** Each payment to (or advance returned by) the instructor, oldest first, with its receipts. */
        payments: paid.get(r.id) ?? [],
        ...figures,
      },
    ]
  })
  return {
    workshops,
    total: {
      received: workshops.reduce((s, w) => s + w.received, 0),
      owed: workshops.reduce((s, w) => s + w.owed, 0),
    },
  }
}

/**
 * Money moved between the business and this instructor, per workshop, from the
 * ledger (a reversal counts under the kind it cancels, with the opposite sign):
 * advances paid (minus returned), the part of the advance booked as workshop
 * costs, and payments of the fee. Only what was booked on or after this
 * instructor's first contract for the workshop (a reversal by the time of what
 * it cancels): when a workshop moved from another instructor, that one's
 * advance, the costs paid from it and their payments are not this one's.
 */
async function instructorMoney(instructorId: string, courseIds: string[]) {
  const out = new Map<string, { advancePaid: number; advanceForCosts: number; payments: number }>()
  if (!courseIds.length) return out
  const first = db
    .select({ courseId: contracts.courseId, since: sql<Date>`min(${contracts.sentAt})`.as("since") })
    .from(contracts)
    .where(and(eq(contracts.instructorId, instructorId), inArray(contracts.courseId, courseIds)))
    .groupBy(contracts.courseId)
    .as("first_contract")
  const original = alias(ledgerTransactions, "original")
  const kind = sql`coalesce(${original.kind}, ${ledgerTransactions.kind})`
  const bookedAt = sql`coalesce(${original.createdAt}, ${ledgerTransactions.createdAt})`
  const sum = (account: string, of: string) =>
    sql<number>`coalesce(sum(${ledgerLines.amount}) filter (where ${ledgerLines.account} = ${account} and ${kind} = ${of}), 0)`.mapWith(
      Number,
    )
  const rows = await db
    .select({
      courseId: ledgerTransactions.courseId,
      advancePaid: sum("instructor_advance", "instructor_advance"),
      advanceForCosts: sum("instructor_advance", "expense"),
      payments: sum("instructor_payable", "instructor_payment"),
    })
    .from(ledgerLines)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerLines.transactionId))
    .innerJoin(first, eq(first.courseId, ledgerTransactions.courseId))
    .leftJoin(original, eq(original.id, ledgerTransactions.reversalOf))
    .where(and(inArray(ledgerTransactions.courseId, courseIds), sql`${bookedAt} >= ${first.since}`))
    .groupBy(ledgerTransactions.courseId)
  for (const r of rows) {
    if (!r.courseId) continue
    // Debit-positive lines: an advance paid is a debit, costs paid from it a credit.
    out.set(r.courseId, { advancePaid: r.advancePaid, advanceForCosts: 0 - r.advanceForCosts, payments: r.payments })
  }
  return out
}

/**
 * The payments themselves, per workshop, oldest first: advances paid or
 * returned and payments of the fee, each with its date, amount and the
 * receipts the team kept with it. Only entries in force (not reversed; an
 * edited one by its corrected version) and, as `instructorMoney`, booked on
 * or after this instructor's first contract for the workshop.
 */
async function instructorPayments(instructorId: string, courseIds: string[]) {
  type Payment = {
    id: string
    kind: "advance" | "advanceReturned" | "payment"
    occurredOn: string
    amount: number
    receipts: { id: string; url: string; pdf: boolean }[]
  }
  const out = new Map<string, Payment[]>()
  if (!courseIds.length) return out
  const t = ledgerTransactions
  const reversal = alias(ledgerTransactions, "reversal")
  const id = sql`${t}.${sql.identifier(t.id.name)}`
  const rows = await db
    .select({
      id: t.id,
      courseId: t.courseId,
      kind: t.kind,
      occurredOn: t.occurredOn,
      // Debit-positive: an advance paid (or a payment) is a debit of its account, an advance returned a credit.
      amount: sql<number>`(select coalesce(sum(l.amount), 0) from ${ledgerLines} l where l.transaction_id = ${id} and l.account in ('instructor_advance', 'instructor_payable'))`.mapWith(Number),
    })
    .from(t)
    .leftJoin(reversal, eq(reversal.reversalOf, t.id))
    .where(
      and(
        inArray(t.courseId, courseIds),
        inArray(t.kind, ["instructor_advance", "instructor_payment"]),
        sql`${t.reversalOf} is null and ${reversal.id} is null`,
        sql`${t.createdAt} >= (select min(c.sent_at) from ${contracts} c where c.course_id = ${t.courseId} and c.instructor_id = ${instructorId})`,
      ),
    )
    .orderBy(asc(t.occurredOn), asc(t.createdAt))
  if (!rows.length) return out
  const [files, url] = await Promise.all([
    db
      .select({ id: expenseFiles.id, transactionId: expenseFiles.transactionId, path: expenseFiles.path, contentType: expenseFiles.contentType })
      .from(expenseFiles)
      .where(inArray(expenseFiles.transactionId, rows.map((r) => r.id)))
      .orderBy(asc(expenseFiles.createdAt), asc(expenseFiles.id)),
    publicUrls(),
  ])
  for (const r of rows) {
    if (!r.courseId) continue
    const receipts = files.flatMap((f) => {
      const link = f.transactionId === r.id ? url(f.path) : null
      return link ? [{ id: f.id, url: link, pdf: f.contentType === "application/pdf" }] : []
    })
    const kind = r.kind === "instructor_payment" ? "payment" : r.amount < 0 ? "advanceReturned" : "advance"
    out.set(r.courseId, [...(out.get(r.courseId) ?? []), { id: r.id, kind, occurredOn: r.occurredOn, amount: Math.abs(r.amount), receipts }])
  }
  return out
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export type MyProfile = NonNullable<Awaited<ReturnType<typeof getMyProfile>>>

/** The instructor's own profile: public fields to edit, private ones to read (ID number masked). */
export async function getMyProfile() {
  const { instructor } = await requireInstructor()
  const [row] = await db
    .select({
      displayName: instructors.displayName,
      teachingField: instructors.teachingField,
      bio: instructors.bio,
      teachingLanguages: instructors.teachingLanguages,
      website: instructors.website,
      photoPath: instructors.photoPath,
      officialName: instructors.officialName,
      idNumberEnc: instructors.idNumberEnc,
      mobile: instructors.mobile,
      email: instructors.email,
      emailVerifiedAt: instructors.emailVerifiedAt,
    })
    .from(instructors)
    .where(eq(instructors.id, instructor.id))
    .limit(1)
  if (!row) return null
  const { idNumberEnc, emailVerifiedAt, ...profile } = row
  return {
    ...profile,
    emailVerified: emailVerifiedAt !== null,
    idNumberMasked: maskedId(idNumberEnc),
    photoUrl: row.photoPath ? await photoUrl(row.photoPath) : null,
  }
}

function maskedId(encrypted: string): string | null {
  try {
    return maskIdNumber(decrypt(encrypted))
  } catch {
    return null
  }
}

/** The signed-in instructor's photo for the panel's header, or null. */
export async function getMyPhotoUrl(instructorId: string): Promise<string | null> {
  const [row] = await db.select({ photoPath: instructors.photoPath }).from(instructors).where(eq(instructors.id, instructorId)).limit(1)
  return row?.photoPath ? photoUrl(row.photoPath) : null
}

async function photoUrl(path: string): Promise<string | null> {
  try {
    return (await getStorage()).publicUrl(path)
  } catch (err) {
    console.error("[instructor-panel] photo URL", errorForLog(err))
    return null
  }
}
