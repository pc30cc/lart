import "server-only"
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import { db } from "@/db"
import {
  contracts,
  courses,
  instructors,
  ledgerLines,
  ledgerTransactions,
  registrations,
  type Locale,
} from "@/db/schema"
import { renderContract } from "@/features/contracts/render"
import { checkSignedText, recordedSignatureHashes, type SignedTextCheck } from "@/features/contracts/signed-text"
import { maskIdNumber } from "@/features/instructors/schema"
import { requireInstructor } from "@/lib/auth/instructor"
import { decrypt, sha256 } from "@/lib/crypto"
import { errorForLog } from "@/lib/errors"
import { getStorage } from "@/lib/storage"
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
/** Seats taken: registrations that are not cancelled, paid or not. */
const seatsTaken = sql<number>`(select count(*) from ${registrations} r where r.course_id = ${courseId} and r.status <> 'cancelled')`.mapWith(Number)
/** Paid registrations: the participant number before the go decision fixes it. */
const paidCount = sql<number>`(select count(*) from ${registrations} r where r.course_id = ${courseId} and r.status = 'confirmed')`.mapWith(Number)

const workshopCard = {
  id: courses.id,
  title: courses.title,
  venue: courses.venue,
  startsAt: courses.startsAt,
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
      endsAt: courses.endsAt,
      status: courses.status,
      cancelledAt: courses.cancelledAt,
      closedAt: courses.closedAt,
      closedTotals: courses.closedTotals,
      finalParticipants: courses.finalParticipants,
      paid: paidCount,
      contractStatus: live.status,
      feeType: live.feeType,
      feeAmount: live.feeAmount,
      advanceAmount: live.advanceAmount,
    })
    .from(courses)
    .innerJoin(live, eq(live.courseId, courses.id))
    .where(eq(courses.instructorId, instructor.id))
    .orderBy(desc(courses.startsAt), asc(courses.id))
  const moved = await instructorMoney(rows.map((r) => r.id))

  const workshops = rows.flatMap((r) => {
    const money = moved.get(r.id) ?? { advancePaid: 0, advanceForCosts: 0, payments: 0 }
    const cancelled = r.status === "cancelled" || r.cancelledAt !== null
    if (cancelled && !money.advancePaid && !money.payments) return []
    const closed = r.closedAt !== null || r.status === "closed"
    const participants = r.closedTotals?.participants ?? r.finalParticipants ?? r.paid
    const figures = workshopEarnings({
      cancelled,
      closedFee: closed ? (r.closedTotals?.instructorFee ?? null) : null,
      contract: { feeType: r.feeType, feeAmount: r.feeAmount },
      participants,
      ...money,
    })
    return [
      {
        id: r.id,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        status: r.status,
        cancelledAt: r.cancelledAt,
        signed: r.contractStatus === "signed",
        closed,
        feeType: r.feeType,
        feeAmount: r.feeAmount,
        participants,
        /** The fee still depends on the number of participants (fixed at the go decision). */
        estimate: !closed && !cancelled && r.feeType === "per_participant" && r.finalParticipants === null,
        advancePaid: money.advancePaid,
        advanceForCosts: money.advanceForCosts,
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
 * Money moved between the business and the instructor, per workshop, from the
 * ledger (a reversal counts under the kind it cancels, with the opposite sign):
 * advances paid (minus returned), the part of the advance booked as workshop
 * costs, and payments of the fee.
 */
async function instructorMoney(courseIds: string[]) {
  const out = new Map<string, { advancePaid: number; advanceForCosts: number; payments: number }>()
  if (!courseIds.length) return out
  const original = alias(ledgerTransactions, "original")
  const kind = sql`coalesce(${original.kind}, ${ledgerTransactions.kind})`
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
    .leftJoin(original, eq(original.id, ledgerTransactions.reversalOf))
    .where(inArray(ledgerTransactions.courseId, courseIds))
    .groupBy(ledgerTransactions.courseId)
  for (const r of rows) {
    if (!r.courseId) continue
    // Debit-positive lines: an advance paid is a debit, costs paid from it a credit.
    out.set(r.courseId, { advancePaid: r.advancePaid, advanceForCosts: 0 - r.advanceForCosts, payments: r.payments })
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

async function photoUrl(path: string): Promise<string | null> {
  try {
    return (await getStorage()).publicUrl(path)
  } catch (err) {
    console.error("[instructor-panel] photo URL", errorForLog(err))
    return null
  }
}
