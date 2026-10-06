import { and, desc, eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, auditLog, categories, contracts, courses, instructors, templates } from "@/db/schema"
import {
  createAdmin,
  createCategory,
  createInstructor,
  defaultContractTemplate,
  runId,
} from "@/features/workshops/test-fixtures"
import { decrypt, sha256 } from "@/lib/crypto"
import { UserError } from "@/lib/errors"
import { getContractText } from "./queries"
import { renderContract } from "./render"
import { signContract } from "./sign"

const sendEmail = vi.hoisted(() => vi.fn<(input: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true })))
vi.mock("@/lib/email", () => ({ sendEmail }))
const session = vi.hoisted(() => ({ sessionId: "test", admin: { id: "", email: "", name: "Signer Tester", shareBp: 0 } }))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const run = runId()
const courseIds: string[] = []
const instructorIds: string[] = []
let adminEmail: string
let categoryId: string
let instructorId: string
let templateId: string

beforeAll(async () => {
  const admin = await createAdmin(run, "Mina")
  adminEmail = admin.email
  Object.assign(session.admin, { id: admin.id, email: admin.email })
  const [category, instructor] = await Promise.all([createCategory(run), createInstructor(run)])
  categoryId = category.id
  instructorId = instructor.id
  instructorIds.push(instructor.id)
  templateId = await defaultContractTemplate()
})

afterAll(async () => {
  await db.delete(contracts).where(inArray(contracts.courseId, courseIds))
  await db.delete(courses).where(inArray(courses.id, courseIds))
  await db.delete(instructors).where(inArray(instructors.id, instructorIds))
  await db.delete(categories).where(eq(categories.id, categoryId))
})

beforeEach(() => sendEmail.mockClear())

/** A workshop awaiting the signature of contract v1 (as createWorkshop leaves it). */
async function pending(template = templateId) {
  const start = new Date(Date.now() + 20 * 86_400_000)
  const [course] = await db
    .insert(courses)
    .values({
      slug: `sign-${run}-${crypto.randomUUID().slice(0, 8)}`,
      categoryId,
      instructorId,
      title: { fa: "سفال", tr: "Seramik", en: "Ceramics" },
      venue: "Atölye 5",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3 * 3_600_000),
      minCapacity: 3,
      maxCapacity: 8,
      price: 200_000,
      registrationDeadline: new Date(start.getTime() - 86_400_000),
      decisionAt: new Date(start.getTime() - 2 * 86_400_000),
      createdBy: session.admin.id,
    })
    .returning()
  courseIds.push(course.id)
  const [contract] = await db
    .insert(contracts)
    .values({ courseId: course.id, instructorId, templateId: template, feeType: "fixed", feeAmount: 500_000, advanceAmount: 0 })
    .returning()
  return { course, contract }
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (err) {
    if (err instanceof UserError) return err.key
    throw err
  }
  throw new Error("expected a UserError")
}

describe("signContract", () => {
  it("stores the exact text (encrypted), its SHA-256 and the evidence, and publishes the workshop", async () => {
    const { course, contract } = await pending()
    const expected = await renderContract(contract.id, "tr")
    const result = await signContract(contract.id, instructorId, "  Zeynep Yılmaz ", "203.0.113.7", "Mozilla/5.0 Test", "tr")
    expect(result).toMatchObject({ contractId: contract.id, courseId: course.id, sha256: sha256(expected) })

    const [row] = await db.select().from(contracts).where(eq(contracts.id, contract.id))
    expect(row).toMatchObject({
      status: "signed",
      signedName: "Zeynep Yılmaz",
      signedLocale: "tr",
      signedTextSha256: sha256(expected),
      signedIp: "203.0.113.7",
      signedUserAgent: "Mozilla/5.0 Test",
    })
    expect(row.signedAt).toBeInstanceOf(Date)
    // The text holds the ID number, so it is stored encrypted; the hash is of the plain text.
    expect(row.signedText).not.toContain("12345678901")
    const signed = decrypt(row.signedText!)
    expect(signed).toBe(expected)
    expect(row.signedTextSha256).toBe(sha256(signed))
    expect(signed).toContain("Zeynep Yılmaz (kimlik numarası: 12345678901)")
    expect(signed).toContain("1. Lart ve Zeynep Yılmaz: Seramik")
    expect(signed).toContain("Kimlik: 12345678901. {unknown} kalır.")

    const [published] = await db.select().from(courses).where(eq(courses.id, course.id))
    expect(published.status).toBe("published")
    expect(published.publishedAt).toBeInstanceOf(Date)

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, "contract"), eq(auditLog.entityId, contract.id)))
      .orderBy(desc(auditLog.at))
    expect(audit).toMatchObject({ action: "contract.sign", adminId: null, data: { sha256: sha256(expected), version: 1 } })

    // Every active super admin hears about it.
    const recipients = sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to)
    expect(recipients).toContain(adminEmail)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      template: "contract_signed",
      props: { workshopTitle: "Seramik", workshopUrl: `/tr/admin/workshops/${course.id}` },
    })
  })

  it("keeps the signed text when the template changes later", async () => {
    const [own] = await db
      .insert(templates)
      .values({ kind: "contract", name: `Own ${run}`, body: { en: "## Old\n\n1. Old clause for {brand}." } })
      .returning()
    const { contract } = await pending(own.id)
    await signContract(contract.id, instructorId, "Zeynep Yılmaz", null, null, "en")
    await db.update(templates).set({ body: { en: "## New\n\n1. New clause." } }).where(eq(templates.id, own.id))

    const shown = await getContractText(contract.id, "fa")
    expect(shown.signed).toBe(true)
    expect(shown.locale).toBe("en")
    expect(shown.text).toContain("1. Old clause for Lart.")
    expect(shown.text).not.toContain("New clause")
    await db.delete(contracts).where(eq(contracts.id, contract.id))
    await db.delete(templates).where(eq(templates.id, own.id))
  })

  it("confirms again a workshop whose go decision was taken before the contract was re-issued", async () => {
    const { course, contract } = await pending()
    // As updateWorkshop leaves a confirmed workshop after a contract change: waiting, final number kept.
    await db.update(courses).set({ finalParticipants: 3 }).where(eq(courses.id, course.id))
    await signContract(contract.id, instructorId, "Zeynep Yılmaz", null, null, "tr")
    const [row] = await db.select().from(courses).where(eq(courses.id, course.id))
    expect(row).toMatchObject({ status: "confirmed", finalParticipants: 3 })
  })

  it("only lets the contract's own instructor sign", async () => {
    const other = await createInstructor(run)
    instructorIds.push(other.id)
    const { contract } = await pending()
    expect(await failure(signContract(contract.id, other.id, "Someone Else", null, null, "en"))).toBe("contracts.errors.notFound")
    expect(await failure(signContract(crypto.randomUUID(), instructorId, "Zeynep", null, null, "en"))).toBe(
      "contracts.errors.notFound",
    )
    expect(await failure(signContract("not-a-uuid", instructorId, "Zeynep", null, null, "en"))).toBe("contracts.errors.notFound")
  })

  it("signs once, never a replaced version, and never for a cancelled workshop", async () => {
    const { course, contract } = await pending()
    await signContract(contract.id, instructorId, "Zeynep Yılmaz", null, null, "fa")
    expect(await failure(signContract(contract.id, instructorId, "Zeynep Yılmaz", null, null, "fa"))).toBe(
      "contracts.errors.alreadySigned",
    )

    const second = await pending()
    await db.update(contracts).set({ status: "void", voidedAt: new Date() }).where(eq(contracts.id, second.contract.id))
    expect(await failure(signContract(second.contract.id, instructorId, "Zeynep Yılmaz", null, null, "tr"))).toBe(
      "contracts.errors.replaced",
    )

    const third = await pending()
    await db.update(courses).set({ status: "cancelled" }).where(eq(courses.id, third.course.id))
    expect(await failure(signContract(third.contract.id, instructorId, "Zeynep Yılmaz", null, null, "tr"))).toBe(
      "contracts.errors.notSignable",
    )
    expect(course.status).toBe("awaiting_signature")
  })

  it("asks for a name", async () => {
    const { contract } = await pending()
    expect(await failure(signContract(contract.id, instructorId, " x ", null, null, "tr"))).toBe("contracts.errors.nameRequired")
    const [row] = await db.select({ status: contracts.status }).from(contracts).where(eq(contracts.id, contract.id))
    expect(row.status).toBe("sent")
  })

  it("does not email inactive admins", async () => {
    const inactive = await createAdmin(run, "Former partner")
    await db.update(admins).set({ active: false }).where(eq(admins.id, inactive.id))
    const { contract } = await pending()
    await signContract(contract.id, instructorId, "Zeynep Yılmaz", null, null, "tr")
    expect(sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to)).not.toContain(inactive.email)
  })
})
