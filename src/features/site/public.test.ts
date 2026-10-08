import { randomUUID } from "node:crypto"
import { inArray } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { categories, courses, media } from "@/db/schema"
import { listOpenWorkshops } from "@/features/registrations/public"
import { createAdmin, createInstructor, runId } from "@/features/workshops/test-fixtures"
import { categoryParam, listPastWorkshops, listPublicCategories } from "./public"

// File addresses on a made-up CDN; `storage.broken` plays a CDN setting that cannot be used.
const storage = vi.hoisted(() => ({ broken: false }))
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  publicUrls: async () => (path: string | null | undefined) => (path && !storage.broken ? `https://cdn.test/${path}` : null),
}))

// The test database is shared with the other test files (running at the same
// time): every check looks at this run's rows only, found by their slugs.
const HOUR = 3_600_000
const DAY = 24 * HOUR
const run = runId()
let adminId: string
let instructor: Awaited<ReturnType<typeof createInstructor>>
const made = { categories: [] as string[], courses: [] as string[] }

async function newCategory(name: { fa?: string; tr: string; en?: string }, sort: number) {
  const [row] = await db
    .insert(categories)
    .values({ slug: `site-${run}-${randomUUID().slice(0, 6)}`, name, sort })
    .returning()
  made.categories.push(row.id)
  return row
}

/** A workshop starting `startsIn` ms from now (negative: in the past). */
async function newCourse(categoryId: string, startsIn: number, values: Partial<typeof courses.$inferInsert> = {}) {
  const start = Date.now() + startsIn
  const [row] = await db
    .insert(courses)
    .values({
      slug: `site-${run}-${randomUUID().slice(0, 8)}`,
      status: "published",
      categoryId,
      instructorId: instructor.id,
      title: { tr: "Mum Yapımı", en: "Candle making", fa: "شمع‌سازی" },
      venue: { tr: "Moda Sanat Evi" },
      startsAt: new Date(start),
      endsAt: new Date(start + 2 * HOUR),
      minCapacity: 1,
      maxCapacity: 10,
      price: 150_000,
      registrationDeadline: new Date(start - HOUR),
      decisionAt: new Date(start - 2 * HOUR),
      publishedAt: new Date(start - 10 * DAY),
      createdBy: adminId,
      ...values,
    })
    .returning()
  made.courses.push(row.id)
  return row
}

beforeAll(async () => {
  adminId = (await createAdmin(run)).id
  instructor = await createInstructor(run)
})

afterAll(async () => {
  if (made.courses.length) {
    await db.delete(media).where(inArray(media.courseId, made.courses))
    await db.delete(courses).where(inArray(courses.id, made.courses))
  }
  if (made.categories.length) await db.delete(categories).where(inArray(categories.id, made.categories))
})

describe("listPublicCategories", () => {
  it("lists the categories of the open workshops, in the admin's order, with how many", async () => {
    const zinc = await newCategory({ tr: "Çinko", en: "Zinc", fa: "روی" }, 1)
    const ash = await newCategory({ tr: "Kül", en: "Ash" }, 1)
    const wax = await newCategory({ tr: "Balmumu", en: "Wax", fa: "موم" }, 0)
    const none = await newCategory({ tr: "Boş", en: "Empty" }, 0)
    await newCourse(zinc.id, 5 * DAY)
    await newCourse(zinc.id, 9 * DAY, { status: "confirmed", finalParticipants: 4 })
    await newCourse(ash.id, 3 * DAY)
    await newCourse(ash.id, -HOUR) // started an hour ago
    await newCourse(wax.id, 20 * DAY)
    // Nothing open in `none`: not signed yet, cancelled, started, closed.
    await newCourse(none.id, 5 * DAY, { status: "awaiting_signature", publishedAt: null })
    await newCourse(none.id, 5 * DAY, { status: "cancelled", cancelledAt: new Date() })
    await newCourse(none.id, -HOUR, { status: "confirmed" })
    await newCourse(none.id, -10 * DAY, { status: "closed", closedAt: new Date() })

    const ours = new Set([zinc, ash, wax, none].map((c) => c.slug))
    const mine = <T extends { slug: string }>(list: T[]) => list.filter((c) => ours.has(c.slug))
    const en = mine(await listPublicCategories("en"))
    expect(en).toEqual([
      { slug: wax.slug, name: "Wax", count: 1 },
      { slug: ash.slug, name: "Ash", count: 1 },
      { slug: zinc.slug, name: "Zinc", count: 2 },
    ])
    // The name in the page's language (Turkish when there is none).
    const fa = mine(await listPublicCategories("fa")).map((c) => c.name)
    expect(fa).toEqual(["موم", ...["روی", "Kül"].sort(new Intl.Collator("fa").compare)])

    // Exactly the workshops the list shows, category by category.
    for (const c of en) {
      const list = await listOpenWorkshops("en", { category: c.slug })
      expect(list).toHaveLength(c.count)
      expect(list.every((w) => w.categorySlug === c.slug && w.category === c.name)).toBe(true)
    }
    expect(await listOpenWorkshops("en", { category: none.slug })).toEqual([])
  })

  it("the category filter keeps only that category; without it the list is as before", async () => {
    const one = await newCategory({ tr: "Seramik", en: "Ceramics" }, 0)
    const other = await newCategory({ tr: "Makrome", en: "Macramé" }, 0)
    const a = await newCourse(one.id, 4 * DAY)
    const b = await newCourse(one.id, 2 * DAY)
    const c = await newCourse(other.id, 3 * DAY)

    const filtered = await listOpenWorkshops("en", { category: one.slug })
    expect(filtered.map((w) => w.id)).toEqual([b.id, a.id])
    expect(filtered[0]).toMatchObject({ category: "Ceramics", categorySlug: one.slug })

    const all = await listOpenWorkshops("en", { limit: 100_000 })
    expect(all.map((w) => w.id)).toEqual(expect.arrayContaining([a.id, b.id, c.id]))
    expect(new Set(all.map((w) => w.categorySlug)).size).toBeGreaterThan(1)
    expect(await listOpenWorkshops("en", { category: "no-such-category" })).toEqual([])
  })
})

describe("listPastWorkshops", () => {
  it("lists closed workshops with a cover or gallery photos, newest first, with up to six photos each", async () => {
    const cat = await newCategory({ tr: "Geçmiş", en: "Past" }, 0)
    const closed = { status: "closed" as const, closedAt: new Date() }
    const newest = await newCourse(cat.id, -1 * DAY, { ...closed, coverPath: `workshops/${run}/cover.webp` })
    const older = await newCourse(cat.id, -10 * DAY, { ...closed, title: { tr: "Çömlek", en: "Pottery" } })
    const bare = await newCourse(cat.id, -5 * DAY, closed) // no cover, no photos
    const cancelled = await newCourse(cat.id, -3 * DAY, {
      status: "cancelled",
      cancelledAt: new Date(),
      closedAt: new Date(),
      coverPath: `workshops/${run}/c.webp`,
    })
    // Closed before cancelled workshops kept their status: still cancelled.
    const oldCancelled = await newCourse(cat.id, -4 * DAY, { ...closed, cancelledAt: new Date(), coverPath: `workshops/${run}/o.webp` })
    const notClosed = await newCourse(cat.id, -2 * DAY, { status: "confirmed", coverPath: `workshops/${run}/n.webp` })

    // Eight gallery photos, stored out of order, plus a sample photo and a video that never show here.
    await db.insert(media).values([
      ...[7, 2, 5, 0, 3, 6, 1, 4].map((sort) => ({
        courseId: newest.id,
        kind: "gallery_photo" as const,
        path: `workshops/${run}/gallery/p${sort}.webp`,
        width: 2400,
        height: 1600 + sort,
        sort,
      })),
      { courseId: newest.id, kind: "sample" as const, path: `workshops/${run}/samples/s.webp`, sort: 0 },
      { courseId: newest.id, kind: "gallery_video" as const, path: `workshops/${run}/videos/v.mp4`, sort: 0 },
      { courseId: older.id, kind: "gallery_photo" as const, path: `workshops/${run}/gallery/q1.webp`, sort: 1 },
      { courseId: older.id, kind: "gallery_photo" as const, path: `workshops/${run}/gallery/q0.webp`, sort: 0 },
      ...[cancelled, oldCancelled, notClosed].map((c) => ({
        courseId: c.id,
        kind: "gallery_photo" as const,
        path: `workshops/${run}/gallery/x.webp`,
      })),
    ])

    const list = (await listPastWorkshops("en", { limit: 50 })).filter((w) => w.slug.startsWith(`site-${run}-`))
    expect(list.map((w) => w.slug)).toEqual([newest.slug, older.slug])
    expect(list[0]).toEqual({
      slug: newest.slug,
      title: "Candle making",
      startsAt: newest.startsAt,
      coverUrl: `https://cdn.test/workshops/${run}/cover.webp`,
      photos: [0, 1, 2, 3, 4, 5].map((n) => ({ url: `https://cdn.test/workshops/${run}/gallery/p${n}.webp`, width: 2400, height: 1600 + n })),
    })
    expect(list[1]).toMatchObject({
      title: "Pottery",
      coverUrl: null,
      photos: [
        { url: `https://cdn.test/workshops/${run}/gallery/q0.webp`, width: null, height: null },
        { url: `https://cdn.test/workshops/${run}/gallery/q1.webp`, width: null, height: null },
      ],
    })
    expect(list.map((w) => w.slug)).not.toContain(bare.slug)

    // In Persian: the Persian title, else the Turkish one.
    const fa = (await listPastWorkshops("fa", { limit: 50 })).filter((w) => w.slug.startsWith(`site-${run}-`))
    expect(fa.map((w) => w.title)).toEqual(["شمع‌سازی", "Çömlek"])

    // Never more than asked.
    expect((await listPastWorkshops("en", { limit: 1 })).length).toBeLessThanOrEqual(1)

    // Only public fields: nothing of the instructor.
    const text = JSON.stringify(list)
    for (const secret of [instructor.email, instructor.officialName, instructor.mobile, instructor.idNumberEnc]) {
      expect(text).not.toContain(secret)
    }
  })

  it("leaves out workshops whose files cannot be linked", async () => {
    const cat = await newCategory({ tr: "Geçmiş", en: "Past" }, 0)
    const w = await newCourse(cat.id, -DAY, { status: "closed", closedAt: new Date(), coverPath: `workshops/${run}/b.webp` })
    storage.broken = true
    try {
      const list = await listPastWorkshops("en", { limit: 50 })
      expect(list.map((p) => p.slug)).not.toContain(w.slug)
    } finally {
      storage.broken = false
    }
  })
})

describe("categoryParam", () => {
  it("takes a well-formed slug, else nothing", () => {
    expect(categoryParam("mum-yapimi")).toBe("mum-yapimi")
    expect(categoryParam(["seramik", "mum"])).toBe("seramik")
    for (const bad of [undefined, "", "Mum", "mum yapimi", "../admin", "-mum", "mum--x", "a".repeat(81), "%2e%2e"]) {
      expect(categoryParam(bad)).toBeNull()
    }
  })
})
