import { and, desc, eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { auditLog, contracts, courses, instructors } from "@/db/schema"
import { renderContract } from "@/features/contracts/render"
import {
  createAdmin,
  createCategory,
  createInstructor,
  defaultContractTemplate,
  runId,
} from "@/features/workshops/test-fixtures"
import type { InstructorSession } from "@/lib/auth/instructor"
import { sha256 } from "@/lib/crypto"
import { remove } from "@/lib/storage"
import { signContractAction, updateProfileAction } from "./actions"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    contracts: (await import("../../../messages/en/contracts.json")).default,
    instructors: (await import("../../../messages/en/instructors.json")).default,
    instructorPanel: (await import("../../../messages/en/instructorPanel.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.9", "user-agent": "Test Browser/1.0" }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))
vi.mock("@/lib/storage", async (original) => ({
  ...(await original<typeof import("@/lib/storage")>()),
  remove: vi.fn(async () => {}),
}))

/** The signed-in instructor (a real row: the audit log and the contracts refer to it). */
const signedIn = vi.hoisted(() => ({ id: "" }))
vi.mock("@/lib/auth/instructor", () => {
  const session = (): InstructorSession => ({
    sessionId: "test",
    instructor: { id: signedIn.id, email: "x@test.local", displayName: { tr: "Zeynep" }, locale: "en", emailVerified: true },
  })
  return { requireInstructor: async () => session(), getInstructor: async () => session() }
})

const run = runId()
const DAY = 86_400_000
let adminId: string
let categoryId: string
let templateId: string
let zeynep: string
let other: string

beforeAll(async () => {
  const [admin, category, a, b] = await Promise.all([createAdmin(run), createCategory(run), createInstructor(run), createInstructor(run)])
  adminId = admin.id
  categoryId = category.id
  zeynep = a.id
  other = b.id
  templateId = await defaultContractTemplate()
})

beforeEach(() => {
  signedIn.id = zeynep
  vi.mocked(remove).mockClear()
})

/** A workshop awaiting the signature of its contract (as createWorkshop leaves it). */
async function awaiting(instructorId = zeynep) {
  const start = new Date(Date.now() + 20 * DAY)
  const [course] = await db
    .insert(courses)
    .values({
      slug: `ip-sign-${run}-${crypto.randomUUID().slice(0, 8)}`,
      categoryId,
      instructorId,
      title: { tr: "Seramik", en: "Ceramics" },
      venue: { tr: "Atölye 5" },
      startsAt: start,
      endsAt: new Date(start.getTime() + 3 * 3_600_000),
      minCapacity: 3,
      maxCapacity: 8,
      price: 200_000,
      registrationDeadline: new Date(start.getTime() - DAY),
      decisionAt: new Date(start.getTime() - 2 * DAY),
      createdBy: adminId,
    })
    .returning()
  const [contract] = await db
    .insert(contracts)
    .values({ courseId: course.id, instructorId, templateId, feeType: "fixed", feeAmount: 500_000 })
    .returning()
  const text = await renderContract(contract.id, "en")
  return { course, contract, input: { contractId: contract.id, locale: "en" as const, textSha256: sha256(text), agree: true as const } }
}

const contractRow = async (id: string) => (await db.select().from(contracts).where(eq(contracts.id, id)))[0]

describe("signContractAction", () => {
  it("signs with the typed name (spacing and case aside) and keeps the evidence; the workshop is published", async () => {
    const { course, contract, input } = await awaiting()
    const result = await signContractAction({ ...input, signedName: "  zeynep   YILMAZ " })
    expect(result).toEqual({ ok: true, data: { workshopStatus: "published" } })

    expect(await contractRow(contract.id)).toMatchObject({
      status: "signed",
      signedName: "zeynep YILMAZ",
      signedLocale: "en",
      signedIp: "203.0.113.9",
      signedUserAgent: "Test Browser/1.0",
      signedTextSha256: input.textSha256,
    })
    const [published] = await db.select({ status: courses.status }).from(courses).where(eq(courses.id, course.id))
    expect(published.status).toBe("published")

    // Signing twice: a friendly "already signed".
    const again = await signContractAction({ ...input, signedName: "Zeynep Yılmaz" })
    expect(again).toMatchObject({ ok: false, error: "This contract is already signed. Thank you!" })
  })

  it("refuses another instructor's contract, as if it did not exist", async () => {
    const { contract, input } = await awaiting(other)
    const result = await signContractAction({ ...input, signedName: "Zeynep Yılmaz" })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("couldn’t find this contract") })
    expect((await contractRow(contract.id)).status).toBe("sent")
  })

  it("refuses a name that is not the official one, with the name to type", async () => {
    const { contract, input } = await awaiting()
    const result = await signContractAction({ ...input, signedName: "Zeynep" })
    expect(result).toMatchObject({ ok: false, fieldErrors: { signedName: expect.stringContaining("Zeynep Yılmaz") } })
    expect((await contractRow(contract.id)).status).toBe("sent")
  })

  it("refuses without the box ticked", async () => {
    const { contract, input } = await awaiting()
    const result = await signContractAction({ ...input, agree: false as never, signedName: "Zeynep Yılmaz" })
    expect(result).toMatchObject({ ok: false, fieldErrors: { agree: "Please tick the box to say you agree." } })
    expect((await contractRow(contract.id)).status).toBe("sent")
  })

  it("refuses when the text changed since the page was opened", async () => {
    const { contract, input } = await awaiting()
    await db.update(instructors).set({ officialName: "Zeynep Yılmaz Kaya" }).where(eq(instructors.id, zeynep))
    try {
      const result = await signContractAction({ ...input, signedName: "Zeynep Yılmaz Kaya" })
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("updated a moment ago") })
      expect((await contractRow(contract.id)).status).toBe("sent")
    } finally {
      await db.update(instructors).set({ officialName: "Zeynep Yılmaz" }).where(eq(instructors.id, zeynep))
    }
  })

  it("refuses a replaced version", async () => {
    const { contract, input } = await awaiting()
    await db.update(contracts).set({ status: "void", voidedAt: new Date() }).where(eq(contracts.id, contract.id))
    const result = await signContractAction({ ...input, signedName: "Zeynep Yılmaz" })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("newer version") })
  })
})

const profile = {
  displayName: { fa: "زینب", tr: "Zeynep", en: "Zeynep" },
  teachingField: { fa: "", tr: "Seramik", en: "Ceramics" },
  bio: { fa: "", tr: "Merhaba", en: "" },
  teachingLanguages: ["tr" as const, "en" as const],
  website: "zeynep.example",
  photoPath: null as string | null,
}

const photo = () => `instructors/2026-10/${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}.webp`

/** What the upload route records for each upload: who uploaded which file. */
async function uploaded(path: string, instructorId: string) {
  await db.insert(auditLog).values({
    adminId: null,
    action: "media.upload",
    entity: "media",
    entityId: path,
    data: { purpose: "instructor_photo", by: "instructor", instructorId },
  })
}

const lastAudit = async (id: string) =>
  (
    await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, "instructor"), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.at))
      .limit(1)
  )[0]

describe("updateProfileAction", () => {
  it("saves the public profile only and audits it as the instructor's change", async () => {
    const result = await updateProfileAction({ ...profile, officialName: "Someone Else", email: "evil@test.local" } as never)
    expect(result).toEqual({ ok: true, data: { saved: true } })

    const [row] = await db.select().from(instructors).where(eq(instructors.id, zeynep))
    expect(row).toMatchObject({
      displayName: { fa: "زینب", tr: "Zeynep", en: "Zeynep" },
      teachingField: { tr: "Seramik", en: "Ceramics" },
      bio: { tr: "Merhaba" },
      teachingLanguages: ["tr", "en"],
      website: "https://zeynep.example",
      officialName: "Zeynep Yılmaz",
    })
    expect(row.email).not.toBe("evil@test.local")
    expect(await lastAudit(zeynep)).toMatchObject({
      adminId: null,
      action: "instructor.profile_update",
      data: expect.objectContaining({ by: "instructor", website: { from: null, to: "https://zeynep.example" } }),
    })
  })

  it("only takes a photo this instructor uploaded, and removes the old one after a change", async () => {
    const someoneElses = photo()
    await uploaded(someoneElses, other)
    const refused = await updateProfileAction({ ...profile, photoPath: someoneElses })
    expect(refused).toMatchObject({ ok: false, fieldErrors: { photoPath: expect.any(String) } })
    expect(await updateProfileAction({ ...profile, photoPath: photo() })).toMatchObject({ ok: false })

    const first = photo()
    const second = photo()
    await uploaded(first, zeynep)
    await uploaded(second, zeynep)
    expect(await updateProfileAction({ ...profile, photoPath: first })).toMatchObject({ ok: true })
    expect(remove).not.toHaveBeenCalled()
    expect(await updateProfileAction({ ...profile, photoPath: second })).toMatchObject({ ok: true })
    expect(remove).toHaveBeenCalledWith(first)

    const [row] = await db.select({ photoPath: instructors.photoPath }).from(instructors).where(eq(instructors.id, zeynep))
    expect(row.photoPath).toBe(second)
    // Saving again without changes keeps it (and writes nothing).
    expect(await updateProfileAction({ ...profile, photoPath: second })).toMatchObject({ ok: true })
  })
})
