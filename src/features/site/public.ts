import "server-only"
import { and, asc, count, desc, eq, exists, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm"
import { cache } from "react"

import { db } from "@/db"
import { categories, courses, media } from "@/db/schema"
import { openWorkshopsWhere } from "@/features/registrations/public"
import { localized } from "@/lib/format"
import { publicUrls } from "@/lib/storage"
import type { PastWorkshop, PublicCategory } from "@/themes/types"

/**
 * Public data the themes show besides the workshop list: categories with open
 * workshops and finished workshops with their photos. Only public fields leave
 * this file (never anything of the instructor). Cached per request.
 */

/** Gallery photos per past workshop. */
const PAST_PHOTOS = 6

/**
 * The category asked for in the workshops list's address
 * (`/workshops?category=<slug>`): a well-formed slug, else null (the whole list).
 */
export function categoryParam(value: string | string[] | undefined): string | null {
  const slug = Array.isArray(value) ? value[0] : value
  return slug && slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null
}

/**
 * Categories that have open workshops (exactly those `listOpenWorkshops`
 * lists), in the admin's order (`sort`, then the name in `locale`), each with
 * how many open workshops it has.
 */
export const listPublicCategories = cache(async (locale: string): Promise<PublicCategory[]> => {
  const rows = await db
    .select({ slug: categories.slug, name: categories.name, sort: categories.sort, count: count() })
    .from(courses)
    .innerJoin(categories, eq(categories.id, courses.categoryId))
    .where(openWorkshopsWhere(new Date()))
    .groupBy(categories.id)
  const byName = new Intl.Collator(locale)
  return rows
    .map((r) => ({ slug: r.slug, name: localized(r.name, locale), sort: r.sort, count: r.count }))
    .sort((a, b) => a.sort - b.sort || byName.compare(a.name, b.name) || a.slug.localeCompare(b.slug))
    .map(({ slug, name, count }) => ({ slug, name, count }))
})

/**
 * Finished workshops, newest first, at most `limit`: held and closed (status
 * "closed"; never a cancelled one, also not an older "closed" row with
 * `cancelledAt`), that have a cover or gallery photos. Each comes with its
 * cover and its first gallery photos in the admin's order. The gallery is
 * public: admins fill it only after closing, with the watermarked photos
 * they chose to publish, minding each participant's consent (README §4
 * "Photo and video consent", §10 "Past workshops gallery").
 */
export function listPastWorkshops(locale: string, { limit = 8 }: { limit?: number } = {}): Promise<PastWorkshop[]> {
  return pastWorkshops(locale, Math.min(Math.max(Math.trunc(limit) || 1, 1), 50))
}

const pastWorkshops = cache(async (locale: string, limit: number): Promise<PastWorkshop[]> => {
  const hasPhotos = exists(
    db
      .select({ one: sql`1` })
      .from(media)
      .where(and(eq(media.courseId, courses.id), eq(media.kind, "gallery_photo"))),
  )
  const rows = await db
    .select({ id: courses.id, slug: courses.slug, title: courses.title, startsAt: courses.startsAt, coverPath: courses.coverPath })
    .from(courses)
    .where(and(eq(courses.status, "closed"), isNull(courses.cancelledAt), or(isNotNull(courses.coverPath), hasPhotos)))
    .orderBy(desc(courses.startsAt), desc(courses.id))
    .limit(limit)
  if (!rows.length) return []

  // The first photos of each workshop's gallery, in the order the admin gave them.
  const ranked = db
    .select({
      courseId: media.courseId,
      path: media.path,
      width: media.width,
      height: media.height,
      n: sql<number>`row_number() over (partition by ${media.courseId} order by ${media.sort}, ${media.createdAt}, ${media.id})`.as("n"),
    })
    .from(media)
    .where(and(inArray(media.courseId, rows.map((r) => r.id)), eq(media.kind, "gallery_photo")))
    .as("ranked")
  const [photos, url] = await Promise.all([
    db.select().from(ranked).where(lte(ranked.n, PAST_PHOTOS)).orderBy(asc(ranked.n)),
    publicUrls(),
  ])

  const photosOf = new Map<string, PastWorkshop["photos"]>()
  for (const p of photos) {
    const src = url(p.path)
    if (src) photosOf.set(p.courseId, [...(photosOf.get(p.courseId) ?? []), { url: src, width: p.width, height: p.height }])
  }
  return rows.flatMap((r) => {
    const coverUrl = url(r.coverPath)
    const own = photosOf.get(r.id) ?? []
    // Nothing to show when its files cannot be linked (the CDN settings are broken).
    if (!coverUrl && !own.length) return []
    return [{ slug: r.slug, title: localized(r.title, locale), startsAt: r.startsAt, coverUrl, photos: own }]
  })
})
