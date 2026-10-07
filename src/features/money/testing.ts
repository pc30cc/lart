/**
 * Test fixtures for the money tests (imported by *.test.ts only). Every call
 * creates fresh rows, so tests never depend on each other or on old data:
 * ledger rows are append-only and stay in the test database.
 */
import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"

import { db } from "@/db"
import { admins, categories, contracts, courses, instructors, members, registrations, templates } from "@/db/schema"

const tag = () => randomUUID().slice(0, 8)
export const EMAIL_PREFIX = "money-test-"

export async function makeAdmin(name: string, shareBp = 0) {
  const [row] = await db
    .insert(admins)
    .values({ email: `${EMAIL_PREFIX}${tag()}@test.local`, name, passwordHash: "x", shareBp })
    .returning({ id: admins.id, name: admins.name })
  return row
}

/** Leave the shared test database tidy: money-test admins are no longer partners. */
export async function retireAdmins(ids: string[]) {
  if (ids.length) await db.update(admins).set({ active: false, shareBp: 0 }).where(inArray(admins.id, ids))
}

/** The rows every workshop needs: category, instructor, templates, a member. */
export async function makeWorld() {
  const t = tag()
  const [category] = await db
    .insert(categories)
    .values({ slug: `money-${t}`, name: { tr: "Para", en: "Money" } })
    .returning({ id: categories.id })
  const [instructor] = await db
    .insert(instructors)
    .values({
      email: `money-instructor-${t}@test.local`,
      officialName: "Ayşe Yılmaz",
      idNumberEnc: "v1.x.x.x",
      mobile: "+900000000000",
      displayName: { tr: "Ayşe", en: "Ayse" },
      teachingField: { tr: "Seramik", en: "Ceramics" },
      approvedAt: new Date(),
    })
    .returning({ id: instructors.id })
  const [contract, terms] = await db
    .insert(templates)
    .values([
      { kind: "contract", name: `contract ${t}`, body: { tr: "Sözleşme" } },
      { kind: "terms", name: `terms ${t}`, body: { tr: "Koşullar" } },
    ])
    .returning({ id: templates.id })
  const [member] = await db
    .insert(members)
    .values({ email: `money-member-${t}@test.local`, name: "Member", passwordHash: "x" })
    .returning({ id: members.id })
  return {
    categoryId: category.id,
    instructorId: instructor.id,
    contractTemplateId: contract.id,
    termsTemplateId: terms.id,
    memberId: member.id,
  }
}
export type World = Awaited<ReturnType<typeof makeWorld>>

const HOUR = 3_600_000

/** A workshop with a live contract. Defaults: confirmed, ended yesterday, fixed fee ₺1.000. */
export async function makeCourse(
  world: World,
  createdBy: string,
  options: {
    status?: "awaiting_signature" | "published" | "confirmed" | "cancelled"
    endsAt?: Date
    finalParticipants?: number | null
    fee?: { type: "fixed" | "per_participant"; amount: number; advance?: number }
    contractStatus?: "sent" | "signed" | "void"
  } = {},
) {
  const endsAt = options.endsAt ?? new Date(Date.now() - 24 * HOUR)
  const startsAt = new Date(endsAt.getTime() - 2 * HOUR)
  const status = options.status ?? "confirmed"
  const [course] = await db
    .insert(courses)
    .values({
      slug: `money-${tag()}-${tag()}`,
      status,
      categoryId: world.categoryId,
      instructorId: world.instructorId,
      title: { tr: "Atölye", en: "Workshop", fa: "کارگاه" },
      venue: { tr: "Studio" },
      startsAt,
      endsAt,
      minCapacity: 1,
      maxCapacity: 20,
      price: 50000,
      registrationDeadline: startsAt,
      decisionAt: startsAt,
      finalParticipants: options.finalParticipants ?? null,
      cancelledAt: status === "cancelled" ? new Date() : null,
      createdBy,
    })
    .returning({ id: courses.id })
  const fee = options.fee ?? { type: "fixed", amount: 100000 }
  await db.insert(contracts).values({
    courseId: course.id,
    instructorId: world.instructorId,
    templateId: world.contractTemplateId,
    status: options.contractStatus ?? "signed",
    feeType: fee.type,
    feeAmount: fee.amount,
    advanceAmount: fee.advance ?? 0,
  })
  return course.id
}

/** A registration; `paid` marks it paid (the ledger payment is posted separately). */
export async function addRegistration(
  world: World,
  courseId: string,
  options: {
    status?: "pending" | "confirmed" | "cancelled"
    amount?: number
    refundAmount?: number | null
    /** When the refund was paid back (null: still owed). */
    refundedAt?: Date | null
  } = {},
) {
  const status = options.status ?? "confirmed"
  const [row] = await db
    .insert(registrations)
    .values({
      courseId,
      memberId: world.memberId,
      participantName: "Participant",
      status,
      amount: options.amount ?? 50000,
      termsTemplateId: world.termsTemplateId,
      termsSha256: "0".repeat(64),
      termsAcceptedAt: new Date(),
      paidAt: status === "pending" ? null : new Date(),
      cancelledAt: status === "cancelled" ? new Date() : null,
      refundAmount: options.refundAmount ?? null,
      refundedAt: options.refundedAt ?? null,
    })
    .returning({ id: registrations.id })
  return row.id
}

export async function courseRow(id: string) {
  const [row] = await db.select().from(courses).where(eq(courses.id, id))
  return row
}
