/**
 * Test helpers for the workshops and contracts tests (not a test file itself).
 * Rows are tagged with a random run id so parallel test files never collide.
 */
import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"

import { db } from "@/db"
import { admins, categories, instructors, members, registrations, templates } from "@/db/schema"
import { encrypt } from "@/lib/crypto"
import type { WorkshopFormValues } from "./schema"

export const runId = () => randomUUID().slice(0, 8)

/** A localized text as the form sends it: every language present, empty when not written. */
export const text = (v: Partial<Record<"fa" | "tr" | "en", string>> = {}) => ({ fa: v.fa ?? "", tr: v.tr ?? "", en: v.en ?? "" })

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** The fixed clauses used by every test (only the default contract template of the test database). */
export const TEST_CONTRACT_BODY = {
  fa: "## بندها\n\n۱. {brand} و {instructor_name} برای {workshop_title} توافق کردند.",
  tr: "## Maddeler\n\n1. {brand} ve {instructor_name}: {workshop_title}, {weekday} {date} {start_time}-{end_time}, {venue}.\n\n2. Karar: {decision_deadline}. Ücret: {fee_amount} ({fee_type}), ön ödeme {advance_amount}. Katılımcı: {min_participants}-{max_participants}. Kimlik: {instructor_id_number}. {unknown} kalır.",
  en: "## Clauses\n\n1. {brand} and {instructor_name} agree on {workshop_title}.\n\n2. Participants may grow after {decision_deadline} only with the instructor's approval.",
}

/** The default contract template, created once per test database. */
export async function defaultContractTemplate(): Promise<string> {
  await db
    .insert(templates)
    .values({ kind: "contract", name: "Test contract", body: TEST_CONTRACT_BODY, isDefault: true })
    .onConflictDoNothing()
  const [row] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.kind, "contract"), eq(templates.isDefault, true)))
  return row.id
}

export async function createAdmin(run: string, name = "Workshop Tester") {
  const [admin] = await db
    .insert(admins)
    .values({ email: `ws-admin-${run}-${randomUUID().slice(0, 4)}@test.local`, name, passwordHash: "x", shareBp: 0 })
    .returning()
  return admin
}

export async function createInstructor(run: string, options: { active?: boolean } = {}) {
  const [row] = await db
    .insert(instructors)
    .values({
      email: `ws-instructor-${run}-${randomUUID().slice(0, 4)}@test.local`,
      officialName: "Zeynep Yılmaz",
      idNumberEnc: encrypt("12345678901"),
      mobile: "+90 555 000 00 00",
      displayName: { tr: "Zeynep", en: "Zeynep", fa: "زینب" },
      teachingField: { tr: "Mum", en: "Candles" },
      active: options.active ?? true,
      approvedAt: new Date(),
    })
    .returning()
  return row
}

export async function createCategory(run: string) {
  const [row] = await db
    .insert(categories)
    .values({ slug: `ws-cat-${run}-${randomUUID().slice(0, 4)}`, name: { fa: "شمع", tr: "Mum", en: "Candles" } })
    .returning()
  return row
}

export async function createTermsTemplate(run: string) {
  const [row] = await db
    .insert(templates)
    .values({ kind: "terms", name: `Terms ${run}`, body: { tr: "Koşullar" } })
    .returning()
  return row
}

export async function createMember(run: string, name = "Ayşe") {
  const [row] = await db
    .insert(members)
    .values({ email: `ws-member-${run}-${randomUUID().slice(0, 6)}@test.local`, name, passwordHash: "x" })
    .returning()
  return row
}

export async function addRegistration(
  courseId: string,
  memberId: string,
  termsTemplateId: string,
  options: { status?: "pending" | "confirmed" | "cancelled"; amount?: number; photo?: boolean; video?: boolean } = {},
) {
  const status = options.status ?? "confirmed"
  const [row] = await db
    .insert(registrations)
    .values({
      courseId,
      memberId,
      participantName: "Participant",
      status,
      amount: options.amount ?? 150_000,
      termsTemplateId,
      termsSha256: "x",
      termsAcceptedAt: new Date(),
      photoConsent: options.photo ?? false,
      videoConsent: options.video ?? false,
      paidAt: status === "confirmed" ? new Date() : null,
    })
    .returning()
  return row
}

/** Valid form input for a workshop two weeks from now. */
export function workshopInput(
  run: string,
  refs: { categoryId: string; instructorId: string },
  overrides: Partial<WorkshopFormValues> = {},
): WorkshopFormValues {
  const start = Date.now() + 14 * DAY
  const iso = (t: number) => new Date(t).toISOString()
  return {
    title: { fa: "شمع‌سازی", tr: `Mum Yapımı ${run}`, en: "Candle making" },
    slug: `mum-yapimi-${run}-${randomUUID().slice(0, 6)}`,
    categoryId: refs.categoryId,
    instructorId: refs.instructorId,
    startsAt: iso(start),
    endsAt: iso(start + 2 * HOUR),
    registrationDeadline: iso(start - DAY),
    decisionAt: iso(start - 2 * DAY),
    venue: text({ tr: "Moda Sanat Evi", en: "Moda Art House" }),
    ageGroup: "adults",
    ageMin: null,
    ageMax: null,
    minCapacity: 4,
    maxCapacity: 10,
    price: 150_000,
    termsTemplateId: null,
    intro: text({ tr: "Kendi mumunuzu yapın." }),
    includes: text({ tr: "Malzemeler" }),
    bringNothing: true,
    bring: text(),
    experienceRequired: false,
    experienceNote: text(),
    notes: text(),
    coverPath: null,
    samples: [],
    feeType: "per_participant",
    feeAmount: 50_000,
    hasAdvance: true,
    advanceAmount: 100_000,
    ...overrides,
  }
}
