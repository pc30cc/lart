import "server-only"
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { cache } from "react"

import { db } from "@/db"
import { categories, courses, instructorDocuments, instructors } from "@/db/schema"
import { profileLanguage, profileText } from "@/features/instructors/schema"
import { errorForLog } from "@/lib/errors"
import { localized } from "@/lib/format"
import { getStorage, type Storage } from "@/lib/storage"

/** Storage for showing files, or null when the CDN settings are broken (pages still render). */
async function storage(): Promise<Storage | null> {
  try {
    return await getStorage()
  } catch (err) {
    console.error("[instructor-documents] storage unavailable", errorForLog(err))
    return null
  }
}
const urlOf = (s: Storage | null, path: string | null) => {
  if (!s || !path) return null
  try {
    return s.publicUrl(path)
  } catch {
    return null
  }
}

const documentColumns = {
  id: instructorDocuments.id,
  path: instructorDocuments.path,
  thumbPath: instructorDocuments.thumbPath,
  contentType: instructorDocuments.contentType,
  title: instructorDocuments.title,
  issuer: instructorDocuments.issuer,
  year: instructorDocuments.year,
  description: instructorDocuments.description,
  createdAt: instructorDocuments.createdAt,
}

const documentRows = (instructorId: string) =>
  db
    .select(documentColumns)
    .from(instructorDocuments)
    .where(eq(instructorDocuments.instructorId, instructorId))
    .orderBy(asc(instructorDocuments.sort), asc(instructorDocuments.createdAt))

/**
 * An instructor's documents with the full file's address: for the instructor
 * themself and the admins only (never the public site, see `getPublicInstructor`).
 */
export async function listDocuments(instructorId: string) {
  const [rows, files] = await Promise.all([documentRows(instructorId), storage()])
  return rows.map(({ path, thumbPath, ...d }) => ({
    ...d,
    isPdf: d.contentType === "application/pdf",
    url: urlOf(files, path),
    thumbUrl: urlOf(files, thumbPath),
  }))
}
export type InstructorDocument = Awaited<ReturnType<typeof listDocuments>>[number]

/** The workshop statuses that count as held at the site (or about to be): never cancelled ones or unsigned contracts. */
const shownStatuses = ["published", "confirmed", "closed"] as const

/**
 * The instructor of a workshop that was published, by the workshop's slug
 * (`/workshops/[slug]/instructor`, not indexed): only an
 * approved, active instructor with public fields only, their documents as
 * small copies (no full file: `thumbUrl` only, none for a PDF) and the
 * workshops they gave or will give here (published at least once, not
 * cancelled), newest first. Cached per request (the page and its metadata).
 */
export const getPublicInstructor = cache(async (slug: string, locale: string, now: Date = new Date()) => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null
  const [course] = await db
    .select({ instructorId: courses.instructorId })
    .from(courses)
    .where(and(eq(courses.slug, slug), isNotNull(courses.publishedAt)))
    .limit(1)
  if (!course) return null
  const id = course.instructorId
  const [row] = await db
    .select({
      id: instructors.id,
      displayName: instructors.displayName,
      teachingField: instructors.teachingField,
      bio: instructors.bio,
      teachingLanguages: instructors.teachingLanguages,
      photoPath: instructors.photoPath,
    })
    .from(instructors)
    .where(and(eq(instructors.id, id), eq(instructors.active, true), isNotNull(instructors.approvedAt)))
    .limit(1)
  if (!row) return null
  const [docs, workshops, files] = await Promise.all([
    documentRows(row.id),
    db
      .select({
        slug: courses.slug,
        title: courses.title,
        startsAt: courses.startsAt,
        endsAt: courses.endsAt,
        days: courses.days,
        status: courses.status,
        coverPath: courses.coverPath,
        category: categories.name,
      })
      .from(courses)
      .innerJoin(categories, eq(categories.id, courses.categoryId))
      .where(and(eq(courses.instructorId, row.id), isNotNull(courses.publishedAt), isNull(courses.cancelledAt), inArray(courses.status, [...shownStatuses])))
      .orderBy(desc(courses.startsAt))
      .limit(60),
    storage(),
  ])
  return {
    id: row.id,
    name: profileText(row.displayName, locale),
    field: profileText(row.teachingField, locale),
    bio: profileText(row.bio, locale),
    fieldLang: profileLanguage(row.teachingField, locale),
    bioLang: profileLanguage(row.bio, locale),
    teachingLanguages: row.teachingLanguages,
    photoUrl: urlOf(files, row.photoPath),
    documents: docs.map((d) => ({
      id: d.id,
      title: d.title,
      issuer: d.issuer,
      year: d.year,
      description: d.description,
      isPdf: d.contentType === "application/pdf",
      // Only the small marked copy leaves the server, never the document itself.
      thumbUrl: urlOf(files, d.thumbPath),
    })),
    workshops: workshops.map((w) => ({
      slug: w.slug,
      title: localized(w.title, locale),
      category: localized(w.category, locale),
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      days: w.days,
      held: w.endsAt <= now,
      coverUrl: urlOf(files, w.coverPath),
    })),
  }
})
/** A workshop of the instructor whose page shows their profile (the latest published), or null when none was. */
export async function profileSlug(instructorId: string): Promise<string | null> {
  const [row] = await db
    .select({ slug: courses.slug })
    .from(courses)
    .where(and(eq(courses.instructorId, instructorId), isNotNull(courses.publishedAt)))
    .orderBy(desc(courses.startsAt))
    .limit(1)
  return row?.slug ?? null
}

export type PublicInstructor = NonNullable<Awaited<ReturnType<typeof getPublicInstructor>>>
