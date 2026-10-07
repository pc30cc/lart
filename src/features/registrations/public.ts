import "server-only"
import { and, asc, count, eq, gt, inArray, isNotNull } from "drizzle-orm"
import { cache } from "react"

import { db, type Tx } from "@/db"
import { categories, courses, instructors, media, registrations, templates } from "@/db/schema"
import { profileText } from "@/features/instructors/schema"
import { fillTemplate } from "@/features/templates/placeholders"
import { getMember } from "@/lib/auth/member"
import { sha256 } from "@/lib/crypto"
import { errorForLog } from "@/lib/errors"
import { localized } from "@/lib/format"
import { getBrand } from "@/lib/settings"
import { getStorage, type Storage } from "@/lib/storage"
import { activeStatuses, registrationWindow, safePaymentUrl, seatLimit } from "./schema"

/**
 * The public side of workshops (no sign-in needed): the open workshops list,
 * one workshop's page, seats, and the terms text shown when registering.
 * Only public fields leave this file: never an instructor's official name,
 * ID number, mobile or email. Phase 3 themes render the same data.
 */

type Exec = Tx | typeof db

/** Workshops that can be found on the site. */
const listedStatuses = ["published", "confirmed"] as const

// ─── Seats ────────────────────────────────────────────────────────────────────

/** Places held in a workshop: registered (not paid yet) and paid registrations. */
export async function seatsTaken(courseId: string, exec: Exec = db): Promise<number> {
  const [row] = await exec
    .select({ n: count() })
    .from(registrations)
    .where(and(eq(registrations.courseId, courseId), inArray(registrations.status, [...activeStatuses])))
  return row.n
}

/** Places still free (never below zero); `limit` is `seatLimit(course)`. */
export const seatsLeft = (limit: number, taken: number) => Math.max(0, limit - taken)

/** Places held per workshop, for lists. */
async function seatsTakenOf(courseIds: string[]): Promise<Map<string, number>> {
  if (!courseIds.length) return new Map()
  const rows = await db
    .select({ courseId: registrations.courseId, n: count() })
    .from(registrations)
    .where(and(inArray(registrations.courseId, courseIds), inArray(registrations.status, [...activeStatuses])))
    .groupBy(registrations.courseId)
  return new Map(rows.map((r) => [r.courseId, r.n]))
}

// ─── Files ────────────────────────────────────────────────────────────────────

/** Storage for showing files, or null when the CDN settings are broken (pages still render). */
async function storage(): Promise<Storage | null> {
  try {
    return await getStorage()
  } catch (err) {
    console.error("[registrations] storage unavailable", errorForLog(err))
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

// ─── Workshops list ───────────────────────────────────────────────────────────

/**
 * Upcoming workshops on the site: published or confirmed, not started yet,
 * soonest first. Those past their registration deadline stay listed as
 * "registration closed".
 */
export async function listOpenWorkshops(locale: string, now: Date = new Date()) {
  const rows = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      status: courses.status,
      title: courses.title,
      venue: courses.venue,
      coverPath: courses.coverPath,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
      registrationDeadline: courses.registrationDeadline,
      maxCapacity: courses.maxCapacity,
      finalParticipants: courses.finalParticipants,
      price: courses.price,
      ageMin: courses.ageMin,
      ageMax: courses.ageMax,
      category: categories.name,
      instructorName: instructors.displayName,
    })
    .from(courses)
    .innerJoin(categories, eq(categories.id, courses.categoryId))
    .innerJoin(instructors, eq(instructors.id, courses.instructorId))
    .where(and(inArray(courses.status, [...listedStatuses]), gt(courses.startsAt, now)))
    .orderBy(asc(courses.startsAt), asc(courses.id))
    .limit(120)
  const [taken, files] = await Promise.all([seatsTakenOf(rows.map((r) => r.id)), storage()])

  return rows.map((r) => {
    const left = seatsLeft(seatLimit(r), taken.get(r.id) ?? 0)
    return {
      id: r.id,
      slug: r.slug,
      title: localized(r.title, locale),
      venue: localized(r.venue, locale),
      category: localized(r.category, locale),
      instructorName: profileText(r.instructorName, locale),
      coverUrl: urlOf(files, r.coverPath),
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      registrationDeadline: r.registrationDeadline,
      price: r.price,
      maxCapacity: r.maxCapacity,
      seatsLeft: left,
      ageMin: r.ageMin,
      ageMax: r.ageMax,
      window: registrationWindow({ ...r, seatsLeft: left }, now),
    }
  })
}

export type WorkshopCard = Awaited<ReturnType<typeof listOpenWorkshops>>[number]

/** The workshop pages the sitemap lists: the open ones (as `listOpenWorkshops`), with when they last changed. */
export async function sitemapWorkshops(now: Date = new Date()) {
  return db
    .select({ slug: courses.slug, updatedAt: courses.updatedAt })
    .from(courses)
    .where(and(inArray(courses.status, [...listedStatuses]), gt(courses.startsAt, now)))
    .orderBy(asc(courses.startsAt), asc(courses.id))
}

// ─── One workshop ─────────────────────────────────────────────────────────────

/**
 * A workshop's public page by its slug, in `locale`. Only workshops that were
 * published at least once (the instructor signed) are found; cancelled, past
 * or paused ones come back with that `window`, so the page can say so.
 * Cached per request (the page and its metadata share it).
 */
export const getPublicWorkshop = cache(async (slug: string, locale: string) => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null
  const [row] = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      status: courses.status,
      cancelledAt: courses.cancelledAt,
      title: courses.title,
      intro: courses.intro,
      includes: courses.includes,
      bring: courses.bring,
      notes: courses.notes,
      experienceRequired: courses.experienceRequired,
      experienceNote: courses.experienceNote,
      ageMin: courses.ageMin,
      ageMax: courses.ageMax,
      venue: courses.venue,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
      registrationDeadline: courses.registrationDeadline,
      maxCapacity: courses.maxCapacity,
      finalParticipants: courses.finalParticipants,
      price: courses.price,
      coverPath: courses.coverPath,
      termsTemplateId: courses.termsTemplateId,
      paymentUrl: courses.paymentUrl,
      category: categories.name,
      // Public instructor fields only.
      instructor: {
        displayName: instructors.displayName,
        teachingField: instructors.teachingField,
        bio: instructors.bio,
        photoPath: instructors.photoPath,
      },
    })
    .from(courses)
    .innerJoin(categories, eq(categories.id, courses.categoryId))
    .innerJoin(instructors, eq(instructors.id, courses.instructorId))
    .where(and(eq(courses.slug, slug), isNotNull(courses.publishedAt)))
    .limit(1)
  if (!row) return null

  const [taken, samples, files] = await Promise.all([
    seatsTaken(row.id),
    db
      .select({ path: media.path, width: media.width, height: media.height })
      .from(media)
      .where(and(eq(media.courseId, row.id), eq(media.kind, "sample")))
      .orderBy(asc(media.sort), asc(media.createdAt)),
    storage(),
  ])
  const left = seatsLeft(seatLimit(row), taken)
  const text = (value: Parameters<typeof localized>[0]) => localized(value, locale)

  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    title: text(row.title),
    intro: text(row.intro),
    includes: text(row.includes),
    /** Empty: nothing needed. */
    bring: text(row.bring),
    notes: text(row.notes),
    experienceRequired: row.experienceRequired,
    experienceNote: text(row.experienceNote),
    ageMin: row.ageMin,
    ageMax: row.ageMax,
    venue: text(row.venue),
    category: text(row.category),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    registrationDeadline: row.registrationDeadline,
    maxCapacity: row.maxCapacity,
    price: row.price,
    seatsLeft: left,
    termsTemplateId: row.termsTemplateId,
    /** The online payment link, only when it is a safe https link (shown to registered students). */
    paymentUrl: safePaymentUrl(row.paymentUrl) ?? null,
    coverUrl: urlOf(files, row.coverPath),
    samples: samples.flatMap((s) => {
      const url = urlOf(files, s.path)
      return url ? [{ url, width: s.width, height: s.height }] : []
    }),
    instructor: {
      name: profileText(row.instructor.displayName, locale),
      field: profileText(row.instructor.teachingField, locale),
      bio: profileText(row.instructor.bio, locale),
      photoUrl: urlOf(files, row.instructor.photoPath),
    },
    window: registrationWindow({ ...row, seatsLeft: left }),
  }
})

export type PublicWorkshop = NonNullable<Awaited<ReturnType<typeof getPublicWorkshop>>>

/**
 * The signed-in member's active registrations for one workshop ("You are
 * registered"), or an empty list for visitors. Scoped to the member.
 */
export async function myActiveRegistrations(courseId: string) {
  const session = await getMember()
  if (!session) return []
  return db
    .select({
      id: registrations.id,
      participantName: registrations.participantName,
      status: registrations.status,
      amount: registrations.amount,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.courseId, courseId),
        eq(registrations.memberId, session.member.id),
        inArray(registrations.status, [...activeStatuses]),
      ),
    )
    .orderBy(asc(registrations.createdAt))
}

// ─── Terms ────────────────────────────────────────────────────────────────────

/**
 * The registration terms of a workshop as shown to the person registering:
 * its own template or the default one, in `locale` (falling back like every
 * text), with {brand} filled in. `sha256` is the proof stored with the
 * registration. Null when there is no terms template at all.
 */
export async function workshopTerms(templateId: string | null, locale: string, exec: Exec = db) {
  const [template] = await exec
    .select({ id: templates.id, body: templates.body })
    .from(templates)
    .where(
      templateId
        ? and(eq(templates.id, templateId), eq(templates.kind, "terms"))
        : and(eq(templates.kind, "terms"), eq(templates.isDefault, true)),
    )
    .limit(1)
  if (!template) return null
  const text = fillTemplate(localized(template.body, locale), { brand: await getBrand(locale) }).trim()
  if (!text) return null
  return { templateId: template.id, text, sha256: sha256(text) }
}
