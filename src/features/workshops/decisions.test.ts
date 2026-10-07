import { eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, categories, courses, instructors, members, registrations, templates } from "@/db/schema"
import { notifyDueDecisions } from "./decisions"
import {
  addRegistration,
  createAdmin,
  createCategory,
  createInstructor,
  createMember,
  createTermsTemplate,
  runId,
} from "./test-fixtures"

type Sent = { to: string; template: string; idempotencyKey: string; props: Record<string, unknown> }
const sendEmail = vi.hoisted(() => vi.fn<(input: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true })))
vi.mock("@/lib/email", () => ({ sendEmail }))

const run = runId()
const HOUR = 3_600_000
const made = { courses: [] as string[] }
let adminId: string
let adminEmail: string
let inactiveEmail: string
let categoryId: string
let instructorId: string
let termsId: string
let memberId: string

beforeAll(async () => {
  const [admin, inactive, category, instructor, terms, member] = await Promise.all([
    createAdmin(run, "Mina"),
    createAdmin(run, "Former partner"),
    createCategory(run),
    createInstructor(run),
    createTermsTemplate(run),
    createMember(run),
  ])
  await db.update(admins).set({ active: false }).where(eq(admins.id, inactive.id))
  adminId = admin.id
  adminEmail = admin.email
  inactiveEmail = inactive.email
  categoryId = category.id
  instructorId = instructor.id
  termsId = terms.id
  memberId = member.id
})

afterAll(async () => {
  await db.delete(registrations).where(inArray(registrations.courseId, made.courses))
  await db.delete(courses).where(inArray(courses.id, made.courses))
  await db.delete(members).where(eq(members.id, memberId))
  await db.delete(templates).where(eq(templates.id, termsId))
  await db.delete(instructors).where(eq(instructors.id, instructorId))
  await db.delete(categories).where(eq(categories.id, categoryId))
})

beforeEach(() => {
  sendEmail.mockReset()
  sendEmail.mockResolvedValue({ ok: true })
})

async function course(status: "awaiting_signature" | "published" | "confirmed", decisionAt: Date) {
  const start = new Date(Date.now() + 3 * 24 * HOUR)
  const [row] = await db
    .insert(courses)
    .values({
      slug: `decision-${run}-${crypto.randomUUID().slice(0, 8)}`,
      status,
      categoryId,
      instructorId,
      title: { tr: `Karar ${run}`, en: "Decision" },
      venue: { tr: "Studio" },
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * HOUR),
      minCapacity: 5,
      maxCapacity: 10,
      price: 100_000,
      registrationDeadline: start,
      decisionAt,
      createdBy: adminId,
    })
    .returning()
  made.courses.push(row.id)
  return row
}

/** Emails sent about one workshop (other test files may run the job's queries at the same time). */
const sentFor = (courseId: string) =>
  sendEmail.mock.calls.map((c) => c[0] as Sent).filter((m) => String(m.props.workshopUrl).endsWith(`/${courseId}`))
const notifiedAt = async (id: string) =>
  (await db.select({ at: courses.decisionNotifiedAt }).from(courses).where(eq(courses.id, id)))[0].at

describe("notifyDueDecisions", () => {
  it("emails every active admin once the decision time has passed, then marks the workshop", async () => {
    const due = await course("published", new Date(Date.now() - HOUR))
    // Paid and not paid yet both count; a cancelled registration does not.
    await addRegistration(due.id, memberId, termsId, { status: "confirmed" })
    await addRegistration(due.id, memberId, termsId, { status: "confirmed" })
    await addRegistration(due.id, memberId, termsId, { status: "pending" })
    await addRegistration(due.id, memberId, termsId, { status: "cancelled" })

    const now = new Date()
    await notifyDueDecisions(now)
    const sent = sentFor(due.id)
    expect(sent.map((m) => m.to)).toContain(adminEmail)
    expect(sent.map((m) => m.to)).not.toContain(inactiveEmail)
    expect(sent.find((m) => m.to === adminEmail)).toMatchObject({
      template: "decision_due",
      idempotencyKey: `decision_due:${due.id}:${adminId}:${due.decisionAt.getTime()}`,
      props: { adminName: "Mina", registrations: 3, minimum: 5, workshopTitle: `Karar ${run}`, workshopUrl: `/admin/workshops/${due.id}` },
    })
    expect(await notifiedAt(due.id)).toEqual(now)

    // Idempotent: the next run leaves it alone.
    sendEmail.mockClear()
    await notifyDueDecisions()
    expect(sentFor(due.id)).toHaveLength(0)
  })

  it("leaves workshops that are not due, not published, or already notified", async () => {
    const future = await course("published", new Date(Date.now() + HOUR))
    const unsigned = await course("awaiting_signature", new Date(Date.now() - HOUR))
    const decided = await course("confirmed", new Date(Date.now() - HOUR))
    await notifyDueDecisions()
    for (const c of [future, unsigned, decided]) {
      expect(sentFor(c.id)).toHaveLength(0)
      expect(await notifiedAt(c.id)).toBeNull()
    }
  })

  it("tries again next time when an email could not be sent", async () => {
    const due = await course("published", new Date(Date.now() - HOUR))
    sendEmail.mockResolvedValue({ ok: false })
    await notifyDueDecisions()
    expect(sentFor(due.id).length).toBeGreaterThan(0)
    expect(await notifiedAt(due.id)).toBeNull()

    sendEmail.mockResolvedValue({ ok: true })
    await notifyDueDecisions()
    expect(await notifiedAt(due.id)).toBeInstanceOf(Date)
  })

  it("handles each workshop once when two runs overlap", async () => {
    const due = await course("published", new Date(Date.now() - HOUR))
    await Promise.all([notifyDueDecisions(), notifyDueDecisions()])
    expect(sentFor(due.id).filter((m) => m.to === adminEmail)).toHaveLength(1)
  })
})
