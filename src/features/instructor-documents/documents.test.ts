import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { auditLog, courses, instructorDocuments } from "@/db/schema"
import { createAdmin, createCategory, createInstructor, runId } from "@/features/workshops/test-fixtures"
import type { InstructorSession } from "@/lib/auth/instructor"
import { remove } from "@/lib/storage"
import { addDocumentAction, deleteDocumentAction, editDocumentAction } from "./actions"
import { getPublicInstructor } from "./queries"
import { addDocumentSchema, MAX_DOCUMENTS } from "./schema"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    instructorPanel: (await import("../../../messages/en/instructorPanel.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/storage", async (original) => ({
  ...(await original<typeof import("@/lib/storage")>()),
  remove: vi.fn(async () => {}),
}))
const signedIn = vi.hoisted(() => ({ id: "" }))
vi.mock("@/lib/auth/instructor", () => {
  const session = (): InstructorSession => ({
    sessionId: "test",
    instructor: { id: signedIn.id, email: "x@test.local", displayName: { tr: "Zeynep" }, locale: "en", emailVerified: true, approved: true },
    impersonatedBy: null,
  })
  return { requireInstructor: async () => session(), getInstructor: async () => session() }
})

const run = runId()
let zeynep: string
let other: string
let categoryId: string
let adminId: string

beforeAll(async () => {
  const [a, b, category, admin] = await Promise.all([createInstructor(run), createInstructor(run), createCategory(run), createAdmin(run)])
  zeynep = a.id
  other = b.id
  categoryId = category.id
  adminId = admin.id
})
beforeEach(() => {
  signedIn.id = zeynep
  vi.mocked(remove).mockClear()
})

/** An upload as the instructor upload route audits it. */
async function uploaded(instructorId: string, ext: "webp" | "pdf" = "webp") {
  const path = `instructors/zeynep/documents/doc-${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}.${ext}`
  const thumbPath = ext === "webp" ? path.replace("/doc-", "/thumb-") : undefined
  await db.insert(auditLog).values({
    action: "media.upload",
    entity: "media",
    entityId: path,
    data: { purpose: "instructor_document", by: "instructor", instructorId, ...(thumbPath ? { thumbPath } : {}) },
  })
  return { path, thumbPath }
}

describe("instructor documents", () => {
  it("adds a document the instructor uploaded, with its public copy", async () => {
    const { path, thumbPath } = await uploaded(zeynep)
    const result = await addDocumentAction({ path, title: "Ceramics certificate", issuer: "Istanbul Art School", year: "۲۰۲۱", description: "120 hours" })
    expect(result.ok).toBe(true)
    const [row] = await db.select().from(instructorDocuments).where(eq(instructorDocuments.path, path))
    expect(row).toMatchObject({ instructorId: zeynep, thumbPath, contentType: "image/webp", year: 2021, issuer: "Istanbul Art School" })
  })

  it("refuses a file someone else uploaded, or one used already", async () => {
    const theirs = await uploaded(other)
    expect((await addDocumentAction({ path: theirs.path, title: "Not mine" })).ok).toBe(false)
    const mine = await uploaded(zeynep, "pdf")
    expect((await addDocumentAction({ path: mine.path, title: "Licence" })).ok).toBe(true)
    expect((await addDocumentAction({ path: mine.path, title: "Again" })).ok).toBe(false)
  })

  it("only edits and removes the instructor's own documents, and removes the files", async () => {
    const { path, thumbPath } = await uploaded(zeynep)
    const added = await addDocumentAction({ path, title: "Glass" })
    if (!added.ok) throw new Error(added.error)
    signedIn.id = other
    expect((await editDocumentAction({ id: added.data.id, title: "Mine now" })).ok).toBe(false)
    expect((await deleteDocumentAction({ id: added.data.id })).ok).toBe(false)
    signedIn.id = zeynep
    expect((await editDocumentAction({ id: added.data.id, title: "Glass art", description: "Level 2" })).ok).toBe(true)
    expect((await deleteDocumentAction({ id: added.data.id })).ok).toBe(true)
    expect(vi.mocked(remove).mock.calls.map((c) => c[0])).toEqual([path, thumbPath])
  })

  it("checks titles, years and paths", () => {
    expect(addDocumentSchema.safeParse({ path: "instructors/x/documents/doc-abc.webp", title: "OK", year: "1800" }).success).toBe(false)
    expect(addDocumentSchema.safeParse({ path: "instructors/x/photo-abc.webp", title: "OK" }).success).toBe(false)
    expect(addDocumentSchema.safeParse({ path: "instructors/x/documents/doc-abc.pdf", title: "OK", year: "" }).data?.year).toBeNull()
    expect(MAX_DOCUMENTS).toBe(20)
  })
})

describe("getPublicInstructor", () => {
  it("shows an approved instructor's small copies only, and their workshops that were not cancelled", async () => {
    const start = new Date(Date.now() - 10 * 86_400_000)
    const base = {
      categoryId,
      instructorId: zeynep,
      title: { en: "Held one" },
      venue: { en: "Studio" },
      startsAt: start,
      endsAt: new Date(start.getTime() + 3_600_000),
      minCapacity: 1,
      maxCapacity: 5,
      price: 1000,
      registrationDeadline: start,
      decisionAt: start,
      createdBy: adminId,
      publishedAt: start,
    }
    await db.insert(courses).values([
      { ...base, slug: `pi-held-${run}`, status: "closed" },
      { ...base, slug: `pi-cancel-${run}`, status: "cancelled", cancelledAt: start },
      { ...base, slug: `pi-draft-${run}`, status: "awaiting_signature", publishedAt: null },
    ])
    const person = await getPublicInstructor(`pi-held-${run}`, "en")
    expect(person?.name).toBe("Zeynep")
    expect(person?.workshops.map((w) => w.slug)).toEqual([`pi-held-${run}`])
    expect(person?.workshops[0].held).toBe(true)
    expect(person?.documents.length).toBeGreaterThan(0)
    for (const d of person!.documents) {
      expect(d).not.toHaveProperty("url")
      expect(d).not.toHaveProperty("path")
      if (d.thumbUrl) expect(d.thumbUrl).toContain("/thumb-")
    }
    // Not through a workshop that was never published, nor an address that is not a slug.
    expect(await getPublicInstructor(`pi-draft-${run}`, "en")).toBeNull()
    expect(await getPublicInstructor("../x", "en")).toBeNull()
  })

  it("is not there for an inactive instructor", async () => {
    const gone = await createInstructor(run, { active: false })
    const [c] = await db.select().from(courses).where(eq(courses.slug, `pi-held-${run}`))
    await db.insert(courses).values({ ...c, id: crypto.randomUUID(), slug: `pi-gone-${run}`, instructorId: gone.id })
    expect(await getPublicInstructor(`pi-gone-${run}`, "en")).toBeNull()
  })
})
