import "server-only"
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
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
 * An instructor's public page by their slug (`/instructors/[slug]`, not
 * indexed): only an
 * approved, active instructor with public fields only, their documents as
 * small copies (no full file: `thumbUrl` only, none for a PDF) and the
 * workshops they gave or will give here (published at least once, not
 * cancelled), newest first. Cached per request (the page and its metadata).
 */
export const getPublicInstructor = cache(async (slug: string, locale: string, now: Date = new Date()) => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null
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
    .where(and(eq(instructors.slug, slug), eq(instructors.active, true), isNotNull(instructors.approvedAt)))
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
      title: profileText(d.title, locale),
      titleLang: profileLanguage(d.title, locale),
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
/** An instructor's slug (their page's address), or null for an unknown id. */
export async function profileSlug(instructorId: string): Promise<string | null> {
  const [row] = await db.select({ slug: instructors.slug }).from(instructors).where(eq(instructors.id, instructorId)).limit(1)
  return row?.slug ?? null
}

/**
 * The instructors list (/instructors, not indexed): approved, active
 * instructors with public fields only, those with the most workshops here
 * first, then by name.
 */
export async function listPublicInstructors(locale: string) {
  const [rows, files] = await Promise.all([
    db
      .select({
        slug: instructors.slug,
        displayName: instructors.displayName,
        teachingField: instructors.teachingField,
        photoPath: instructors.photoPath,
        workshops: sql<number>`(select count(*)::int from ${courses} c where c.instructor_id = "instructors"."id"
          and c.published_at is not null and c.cancelled_at is null and c.status in ('published', 'confirmed', 'closed'))`,
        documents: sql<number>`(select count(*)::int from ${instructorDocuments} d where d.instructor_id = "instructors"."id")`,
      })
      .from(instructors)
      .where(and(eq(instructors.active, true), isNotNull(instructors.approvedAt))),
    storage(),
  ])
  return rows
    .map((r) => ({
      slug: r.slug,
      name: profileText(r.displayName, locale),
      field: profileText(r.teachingField, locale),
      fieldLang: profileLanguage(r.teachingField, locale),
      photoUrl: urlOf(files, r.photoPath),
      workshops: r.workshops,
      documents: r.documents,
    }))
    .sort((a, b) => b.workshops - a.workshops || a.name.localeCompare(b.name, locale))
}

export type PublicInstructor = NonNullable<Awaited<ReturnType<typeof getPublicInstructor>>>
