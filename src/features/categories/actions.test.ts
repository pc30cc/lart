import { randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { parseTableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { admins, auditLog, categories, courses, instructors } from "@/db/schema"
import { createCategory, deleteCategory, updateCategory } from "./actions"
import { getCategory, listCategories } from "./queries"
import { categoryTable } from "./schema"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    categories: (await import("../../../messages/en/categories.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

const session = vi.hoisted(() => ({
  sessionId: "test",
  admin: { id: "", email: "", name: "Category Tester", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const run = randomUUID().slice(0, 8)
const name = (s: string) => ({ fa: `${s} fa`, tr: `${s} tr ${run}`, en: `${s} en` })
const created: string[] = []

async function create(label: string, slug = `${label}-${run}`) {
  const result = await createCategory({ name: name(label), slug, sort: 5 })
  if (!result.ok) throw new Error(result.error)
  created.push(result.data.id)
  return result.data.id
}

const lastAudit = async (entityId: string) =>
  (
    await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, "category"), eq(auditLog.entityId, entityId)))
      .orderBy(desc(auditLog.at))
  )[0]

let instructorId: string
const courseIds: string[] = []

beforeAll(async () => {
  const [admin] = await db
    .insert(admins)
    .values({ email: `cat-${run}@test.local`, name: "Category Tester", passwordHash: "x" })
    .returning()
  session.admin.id = admin.id
  session.admin.email = admin.email
  const [instructor] = await db
    .insert(instructors)
    .values({
      email: `cat-instructor-${run}@test.local`,
      officialName: "Test Instructor",
      idNumberEnc: "v1.x.x.x",
      mobile: "+900000000000",
      displayName: { tr: "Eğitmen", en: "Instructor" },
      teachingField: { tr: "Mum", en: "Candles" },
    })
    .returning()
  instructorId = instructor.id
})

afterAll(async () => {
  for (const id of courseIds) await db.delete(courses).where(eq(courses.id, id))
  for (const id of created) await db.delete(categories).where(eq(categories.id, id))
  await db.delete(instructors).where(eq(instructors.id, instructorId))
})

async function addCourse(categoryId: string) {
  const start = new Date(Date.now() + 7 * 86_400_000)
  const [course] = await db
    .insert(courses)
    .values({
      slug: `course-${randomUUID()}`,
      categoryId,
      instructorId,
      title: { tr: "Atölye" },
      venue: "Studio",
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * 3_600_000),
      minCapacity: 3,
      maxCapacity: 10,
      price: 150000,
      registrationDeadline: start,
      decisionAt: start,
      createdBy: session.admin.id,
    })
    .returning({ id: courses.id })
  courseIds.push(course.id)
}

describe("category actions", () => {
  it("creates a category and audits it", async () => {
    const id = await create("candles")
    const row = await getCategory(id)
    expect(row).toMatchObject({ slug: `candles-${run}`, name: name("candles"), sort: 5, workshops: 0 })
    expect(await lastAudit(id)).toMatchObject({ adminId: session.admin.id, action: "category.create" })
  })

  it("trims names and drops nothing required", async () => {
    const result = await createCategory({ name: { fa: "  ", tr: "Mum", en: "Candle" }, slug: `x-${run}`, sort: 0 })
    expect(result).toMatchObject({ ok: false, fieldErrors: { "name.fa": "Please fill this in." } })
  })

  it("refuses a slug that is already used, on the slug field", async () => {
    await create("pottery")
    const result = await createCategory({ name: name("pottery 2"), slug: `pottery-${run}`, sort: 0 })
    const message = "Another category already uses this page address. Please choose a different one."
    expect(result).toEqual({ ok: false, error: message, fieldErrors: { slug: message } })
  })

  it("updates only what changed and audits the difference", async () => {
    const id = await create("painting")
    const result = await updateCategory({ id, name: name("painting"), slug: `painting-new-${run}`, sort: 5 })
    expect(result).toEqual({ ok: true, data: { id } })
    const audit = await lastAudit(id)
    expect(audit.action).toBe("category.update")
    expect(audit.data).toEqual({ slug: { from: `painting-${run}`, to: `painting-new-${run}` } })

    // Saving again without changes writes no audit entry.
    await updateCategory({ id, name: name("painting"), slug: `painting-new-${run}`, sort: 5 })
    expect((await lastAudit(id)).id).toBe(audit.id)
  })

  it("says so when the category is gone", async () => {
    const result = await updateCategory({ id: randomUUID(), name: name("ghost"), slug: `ghost-${run}`, sort: 0 })
    expect(result).toEqual({ ok: false, error: "This category no longer exists. It may have just been deleted." })
  })

  it("deletes an unused category and audits it", async () => {
    const id = await create("weaving")
    expect(await deleteCategory({ id })).toEqual({ ok: true, data: { id } })
    expect(await getCategory(id)).toBeNull()
    expect(await lastAudit(id)).toMatchObject({ action: "category.delete", data: { slug: `weaving-${run}` } })
  })

  it("refuses to delete a category that workshops use", async () => {
    const id = await create("ceramics")
    await addCourse(id)
    await addCourse(id)
    expect(await deleteCategory({ id })).toEqual({
      ok: false,
      error: "2 workshops use this category, so it can’t be deleted.",
    })
    expect(await getCategory(id)).not.toBeNull()
  })

  it("rejects a malformed id", async () => {
    expect(await deleteCategory({ id: "../etc" })).toMatchObject({ ok: false })
  })
})

describe("listCategories", () => {
  it("searches, filters by usage and sorts", async () => {
    const parse = (sp: Record<string, string>) =>
      parseTableParams(sp, { sort: categoryTable.sort, defaultSort: "sort", filters: categoryTable.filters })

    const all = await listCategories(parse({ q: run, sort: "name" }), "en")
    const names = all.rows.map((r) => r.name.en)
    expect(names).toEqual([...names].sort((a, b) => a!.localeCompare(b!)))
    expect(all.total).toBe(all.rows.length)
    expect(all.total).toBeGreaterThanOrEqual(4)

    const used = await listCategories(parse({ q: run, usage: "used" }), "en")
    expect(used.rows.map((r) => r.slug)).toEqual([`ceramics-${run}`])
    expect(used.rows[0].workshops).toBe(2)

    const unused = await listCategories(parse({ q: run, usage: "unused" }), "en")
    expect(unused.rows.every((r) => r.workshops === 0)).toBe(true)

    const bySlug = await listCategories(parse({ q: `pottery-${run}` }), "en")
    expect(bySlug.rows).toHaveLength(1)

    const wildcard = await listCategories(parse({ q: "%" }), "en")
    expect(wildcard.rows.every((r) => JSON.stringify(r.name).includes("%") || r.slug.includes("%"))).toBe(true)
  })
})
