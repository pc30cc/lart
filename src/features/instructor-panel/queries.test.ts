import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { contracts, courses, type ClosedTotals } from "@/db/schema"
import { postAdvance, postExpense, postInstructorPayment, postTransaction, reverseTransaction, today } from "@/features/money/ledger"
import {
  addRegistration,
  createAdmin,
  createCategory,
  createInstructor,
  createMember,
  createTermsTemplate,
  defaultContractTemplate,
  runId,
} from "@/features/workshops/test-fixtures"
import type { InstructorSession } from "@/lib/auth/instructor"
import { sha256 } from "@/lib/crypto"
import { getMyContract, getMyEarnings, getMyProfile, getMyWorkshop, listContractsToSign, listMyContracts, listMyWorkshops } from "./queries"

/** The signed-in instructor of each call: every query must only ever see this one's data. */
const signedIn = vi.hoisted(() => ({ id: "" }))
vi.mock("@/lib/auth/instructor", () => {
  const session = (): InstructorSession => ({
    sessionId: "test",
    instructor: { id: signedIn.id, email: "x@test.local", displayName: { tr: "X" }, locale: "en", emailVerified: true, approved: true },
  })
  return { requireInstructor: async () => session(), getInstructor: async () => session() }
})

const run = runId()
const DAY = 86_400_000
let adminId: string
let categoryId: string
let contractTemplateId: string
let termsId: string
let memberId: string
let zeynep: string
let other: string

beforeAll(async () => {
  const [admin, category, a, b, terms, member] = await Promise.all([
    createAdmin(run),
    createCategory(run),
    createInstructor(run),
    createInstructor(run),
    createTermsTemplate(run),
    createMember(run),
  ])
  adminId = admin.id
  categoryId = category.id
  zeynep = a.id
  other = b.id
  termsId = terms.id
  memberId = member.id
  contractTemplateId = await defaultContractTemplate()
})

/** A workshop of `instructorId` with its contract (status and fee as given). */
async function workshop(
  instructorId: string,
  options: {
    status?: (typeof courses.$inferInsert)["status"]
    contract?: "sent" | "signed"
    startsIn?: number
    fee?: { type: "fixed" | "per_participant"; amount: number }
    finalParticipants?: number | null
  } = {},
) {
  const startsAt = new Date(Date.now() + (options.startsIn ?? 10) * DAY)
  const [course] = await db
    .insert(courses)
    .values({
      slug: `ip-${run}-${crypto.randomUUID().slice(0, 8)}`,
      status: options.status ?? "published",
      categoryId,
      instructorId,
      title: { tr: `Seramik ${run}`, en: `Ceramics ${run}` },
      venue: { tr: "Atölye 5" },
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
      minCapacity: 2,
      maxCapacity: 8,
      price: 100_000,
      registrationDeadline: new Date(startsAt.getTime() - DAY),
      decisionAt: new Date(startsAt.getTime() - 2 * DAY),
      finalParticipants: options.finalParticipants ?? null,
      createdBy: adminId,
    })
    .returning()
  const fee = options.fee ?? { type: "fixed", amount: 500_000 }
  const [contract] = await db
    .insert(contracts)
    .values({
      courseId: course.id,
      instructorId,
      templateId: contractTemplateId,
      status: options.contract ?? "signed",
      feeType: fee.type,
      feeAmount: fee.amount,
    })
    .returning()
  return { course, contract }
}

const as = (id: string) => (signedIn.id = id)

describe("scoping: an instructor only ever sees their own data", () => {
  it("contracts: someone else's contract reads as not found", async () => {
    const mine = await workshop(zeynep, { status: "awaiting_signature", contract: "sent" })
    const theirs = await workshop(other, { status: "awaiting_signature", contract: "sent" })

    as(zeynep)
    expect(await getMyContract(theirs.contract.id, "en")).toBeNull()
    expect(await getMyContract("not-a-uuid", "en")).toBeNull()
    const ids = (await listMyContracts()).map((c) => c.id)
    expect(ids).toContain(mine.contract.id)
    expect(ids).not.toContain(theirs.contract.id)
    expect((await listContractsToSign()).map((c) => c.id)).toContain(mine.contract.id)

    as(other)
    expect(await getMyContract(mine.contract.id, "en")).toBeNull()
    expect((await listContractsToSign()).map((c) => c.id)).not.toContain(mine.contract.id)
  })

  it("workshops: someone else's workshop reads as not found, and lists hold only mine", async () => {
    const mine = await workshop(zeynep)
    const theirs = await workshop(other)

    as(zeynep)
    expect(await getMyWorkshop(theirs.course.id)).toBeNull()
    expect(await getMyWorkshop("1")).toBeNull()
    const { upcoming } = await listMyWorkshops()
    expect(upcoming.map((w) => w.id)).toContain(mine.course.id)
    expect(upcoming.map((w) => w.id)).not.toContain(theirs.course.id)

    as(other)
    expect(await getMyWorkshop(mine.course.id)).toBeNull()
  })
})

describe("getMyContract", () => {
  it("a contract to sign: the text in the page's language and the fingerprint the sign form sends", async () => {
    const { contract } = await workshop(zeynep, { status: "awaiting_signature", contract: "sent" })
    as(zeynep)
    const mine = await getMyContract(contract.id, "tr")
    expect(mine).toMatchObject({ state: "toSign", doc: { locale: "tr", check: null } })
    expect(mine?.doc?.text).toContain("Zeynep Yılmaz")
    expect(mine?.sign).toEqual({ textSha256: sha256(mine!.doc!.text!), officialName: "Zeynep Yılmaz" })
  })

  it("a replaced version has no text to sign and points to the newer one", async () => {
    const { course, contract } = await workshop(zeynep, { status: "awaiting_signature", contract: "sent" })
    await db.update(contracts).set({ status: "void", voidedAt: new Date() }).where(eq(contracts.id, contract.id))
    const [newer] = await db
      .insert(contracts)
      .values({ courseId: course.id, instructorId: zeynep, version: 2, templateId: contractTemplateId, feeType: "fixed", feeAmount: 1 })
      .returning()
    as(zeynep)
    expect(await getMyContract(contract.id, "en")).toMatchObject({ state: "replaced", doc: null, sign: null, newerId: newer.id })
  })

  it("a contract whose workshop was cancelled can no longer be signed", async () => {
    const { contract } = await workshop(zeynep, { status: "cancelled", contract: "sent" })
    as(zeynep)
    expect(await getMyContract(contract.id, "en")).toMatchObject({ state: "closed", doc: null, sign: null })
  })
})

describe("getMyWorkshop", () => {
  it("lists who is coming by name and consent only: no contact details, no payment status", async () => {
    const { course } = await workshop(zeynep)
    await addRegistration(course.id, memberId, termsId, { status: "confirmed", photo: true })
    await addRegistration(course.id, memberId, termsId, { status: "pending", video: true })
    await addRegistration(course.id, memberId, termsId, { status: "cancelled", photo: true, video: true })

    as(zeynep)
    const mine = await getMyWorkshop(course.id)
    expect(mine?.participants).toEqual([
      { name: "Participant", photo: true, video: false },
      { name: "Participant", photo: false, video: true },
    ])
    expect(mine?.registered).toBe(2)
    expect(mine?.contract).toMatchObject({ status: "signed" })
  })
})

describe("getMyEarnings", () => {
  it("adds up the fee, the advance, the payments (reversals included) and what is still owed", async () => {
    // A finished workshop: ₺500 per participant, 3 participants (final number).
    const { course } = await workshop(zeynep, {
      status: "confirmed",
      startsIn: -3,
      fee: { type: "per_participant", amount: 50_000 },
      finalParticipants: 3,
    })
    const common = { occurredOn: today(), description: "", createdBy: adminId }
    await db.transaction(async (tx) => {
      await postAdvance(tx, { ...common, courseId: course.id, amount: 40_000, direction: "paid" })
      await postExpense(tx, { ...common, courseId: course.id, amount: 10_000, source: "advance" })
    })

    as(zeynep)
    const before = (await getMyEarnings()).workshops.find((w) => w.id === course.id)
    expect(before).toMatchObject({
      fee: 150_000,
      advancePaid: 40_000,
      advanceForCosts: 10_000,
      received: 30_000,
      owed: 120_000,
      toReturn: 0,
      estimate: false,
      closed: false,
    })

    // Closing (as money/closing.ts posts it), then payments to the instructor.
    await db.transaction(async (tx) => {
      await postTransaction(tx, {
        ...common,
        kind: "course_settlement",
        courseId: course.id,
        lines: [
          { account: "instructor_fees", amount: 150_000 },
          { account: "instructor_advance", amount: -30_000 },
          { account: "instructor_payable", amount: -120_000 },
        ],
      })
      const totals: ClosedTotals = { revenue: 0, instructorFee: 150_000, expenses: 10_000, netProfit: -160_000, participants: 3, partners: [] }
      await tx.update(courses).set({ status: "closed", closedAt: new Date(), closedTotals: totals }).where(eq(courses.id, course.id))
    })
    const mistake = await db.transaction((tx) =>
      postInstructorPayment(tx, { ...common, courseId: course.id, amount: 70_000 }),
    )
    await reverseTransaction(mistake, adminId)
    await db.transaction((tx) => postInstructorPayment(tx, { ...common, courseId: course.id, amount: 50_000 }))

    const after = (await getMyEarnings()).workshops.find((w) => w.id === course.id)
    expect(after).toMatchObject({ fee: 150_000, received: 80_000, owed: 70_000, closed: true })
  })

  it("a per-participant fee before the go decision is an estimate from everyone registered, paid or not yet", async () => {
    const { course } = await workshop(zeynep, { fee: { type: "per_participant", amount: 20_000 } })
    await addRegistration(course.id, memberId, termsId, { status: "confirmed" })
    await addRegistration(course.id, memberId, termsId, { status: "pending" })
    await addRegistration(course.id, memberId, termsId, { status: "cancelled" })
    as(zeynep)
    const row = (await getMyEarnings()).workshops.find((w) => w.id === course.id)
    expect(row).toMatchObject({ fee: 40_000, participants: 2, estimate: true, owed: 40_000 })
  })

  it("a cancelled workshop shows only when an advance is to be returned", async () => {
    const withAdvance = await workshop(zeynep)
    const without = await workshop(zeynep)
    await db.transaction((tx) =>
      postAdvance(tx, {
        occurredOn: today(),
        description: "",
        createdBy: adminId,
        courseId: withAdvance.course.id,
        amount: 25_000,
        direction: "paid",
      }),
    )
    for (const { course } of [withAdvance, without]) {
      await db.update(courses).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(courses.id, course.id))
    }
    as(zeynep)
    const { workshops } = await getMyEarnings()
    expect(workshops.find((w) => w.id === withAdvance.course.id)).toMatchObject({ fee: 0, received: 25_000, owed: 0, toReturn: 25_000 })
    expect(workshops.find((w) => w.id === without.course.id)).toBeUndefined()
  })

  it("a workshop taken over from another instructor counts only what moved since this instructor's contract", async () => {
    // The other instructor got an advance, spent part of it on costs and returned the rest.
    const { course, contract } = await workshop(other)
    const common = { occurredOn: today(), description: "", createdBy: adminId, courseId: course.id }
    await db.transaction(async (tx) => {
      await postAdvance(tx, { ...common, amount: 40_000, direction: "paid" })
      await postExpense(tx, { ...common, amount: 10_000, source: "advance" })
      await postAdvance(tx, { ...common, amount: 30_000, direction: "returned" })
    })
    // Then the workshop moved to Zeynep, who got an advance of her own.
    await db.update(contracts).set({ status: "void", voidedAt: new Date() }).where(eq(contracts.id, contract.id))
    await db.update(courses).set({ instructorId: zeynep }).where(eq(courses.id, course.id))
    await db.insert(contracts).values({
      courseId: course.id,
      instructorId: zeynep,
      version: 2,
      templateId: contractTemplateId,
      status: "signed",
      feeType: "fixed",
      feeAmount: 500_000,
      sentAt: new Date(Date.now() + 1_000),
    })
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    await db.transaction((tx) => postAdvance(tx, { ...common, amount: 20_000, direction: "paid" }))

    as(zeynep)
    const row = (await getMyEarnings()).workshops.find((w) => w.id === course.id)
    expect(row).toMatchObject({ fee: 500_000, advancePaid: 20_000, advanceForCosts: 0, received: 20_000, owed: 480_000 })
  })

  it("never includes someone else's workshops", async () => {
    const theirs = await workshop(other)
    as(zeynep)
    expect((await getMyEarnings()).workshops.map((w) => w.id)).not.toContain(theirs.course.id)
  })
})

describe("getMyProfile", () => {
  it("shows the ID number masked, never the stored value", async () => {
    as(zeynep)
    const profile = await getMyProfile()
    expect(profile).toMatchObject({ officialName: "Zeynep Yılmaz", idNumberMasked: "••••••901", photoUrl: null })
    expect(profile).not.toHaveProperty("idNumberEnc")
    expect(JSON.stringify(profile)).not.toContain("12345678901")
  })
})
