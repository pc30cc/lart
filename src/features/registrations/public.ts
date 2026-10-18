import "server-only"
import { and, asc, count, eq, gt, inArray, isNotNull, sql } from "drizzle-orm"
import { cache } from "react"

import { db, type Tx } from "@/db"
import { categories, courses, instructors, media, registrations, seatHolds, templates } from "@/db/schema"
import { profileLanguage, profileText } from "@/features/instructors/schema"
import { fillTemplate } from "@/features/templates/placeholders"
import { getMember } from "@/lib/auth/member"
import { sha256 } from "@/lib/crypto"
import { errorForLog } from "@/lib/errors"
import { fallbackLanguage, localized, ownText } from "@/lib/format"
import { getBrand, getSetting } from "@/lib/settings"
import { getStorage, type Storage } from "@/lib/storage"
import { activeStatuses, daySeatsLeft, registrationWindow, safePaymentUrl } from "./schema"

/**
 * The public side of workshops (no sign-in needed): the open workshops list,
 * one workshop's page, seats, and the terms text shown when registering.
 * Only public fields leave this file: never an instructor's official name,
 * ID number, mobile or email. Phase 3 themes render the same data.
 */

type Exec = Tx | typeof db

/** Workshops that can be found on the site. */
const listedStatuses = ["published", "confirmed"] as const

/**
 * The open workshops at `now`: listed (published or confirmed) and not started
 * yet. The one rule behind the workshops list, its categories
 * (site/public.ts) and the sitemap.
 */
export const openWorkshopsWhere = (now: Date) =>
  and(inArray(courses.status, [...listedStatuses]), gt(courses.startsAt, now))

// ─── Seats ────────────────────────────────────────────────────────────────────

/**
 * Places taken in a workshop: registered (not paid yet) and paid
 * registrations, and the places admins hold for guests (`seat_holds`).
 */
export async function seatsTaken(courseId: string, exec: Exec = db): Promise<number> {
  return (await seatsTakenByDay(courseId, exec)).reduce((a, b) => a + b, 0)
}

/** The registrations' day (null, a one-day workshop's, is the first). */
const dayIndex = sql<number>`coalesce(${registrations.day}, 0)`.mapWith(Number)
/** The same for the places held. */
const holdDay = sql<number>`coalesce(${seatHolds.day}, 0)`.mapWith(Number)
const holdCount = sql<number>`coalesce(sum(${seatHolds.count}), 0)`.mapWith(Number)

/** Places taken on each day of a workshop (index = day; one entry for a one-day workshop): registrations and holds. */
export async function seatsTakenByDay(courseId: string, exec: Exec = db): Promise<number[]> {
  const [rows, held] = await Promise.all([
    exec
      .select({ day: dayIndex, n: count() })
      .from(registrations)
      .where(and(eq(registrations.courseId, courseId), inArray(registrations.status, [...activeStatuses])))
      .groupBy(dayIndex),
    exec.select({ day: holdDay, n: holdCount }).from(seatHolds).where(eq(seatHolds.courseId, courseId)).groupBy(holdDay),
  ])
  return toDays([...rows, ...held])
}

/** Per day, the counts added up (registrations and holds may give the same day twice). */
const toDays = (rows: { day: number; n: number }[]) => {
  const out: number[] = []
  for (const r of rows) out[r.day] = (out[r.day] ?? 0) + r.n
  return Array.from(out, (n) => n ?? 0)
}

/** Places still free (never below zero); `limit` is `seatLimit(course)`. */
export const seatsLeft = (limit: number, taken: number) => Math.max(0, limit - taken)

/** Places taken (registrations and held places) per workshop and day, for lists. */
export async function seatsTakenOf(courseIds: string[], exec: Exec = db): Promise<Map<string, number[]>> {
  if (!courseIds.length) return new Map()
  const [taken, held] = await Promise.all([
    exec
      .select({ courseId: registrations.courseId, day: dayIndex, n: count() })
      .from(registrations)
      .where(and(inArray(registrations.courseId, courseIds), inArray(registrations.status, [...activeStatuses])))
      .groupBy(registrations.courseId, dayIndex),
    exec
      .select({ courseId: seatHolds.courseId, day: holdDay, n: holdCount })
      .from(seatHolds)
      .where(inArray(seatHolds.courseId, courseIds))
      .groupBy(seatHolds.courseId, holdDay),
  ])
  const rows = [...taken, ...held]
  const byCourse = new Map<string, { day: number; n: number }[]>()
  for (const r of rows) byCourse.set(r.courseId, [...(byCourse.get(r.courseId) ?? []), r])
  return new Map([...byCourse].map(([id, list]) => [id, toDays(list)]))
}

/**
 * What visitors may see of the places: how many registered and how many are
 * left, or null when Settings → General hides it (then only "Full").
 */
export type ShownSeats = { taken: number; left: number } | null

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)

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
 * soonest first, at most `limit` (the home page shows a few). Those past their
 * registration deadline stay listed as "registration closed". `category` (a
 * category's slug) keeps only that category's workshops.
 */
export async function listOpenWorkshops(
  locale: string,
  { now = new Date(), limit = 120, category }: { now?: Date; limit?: number; category?: string } = {},
) {
  const rows = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      status: courses.status,
      title: courses.title,
      venue: courses.venue,
      coverPath: courses.coverPath,
      startsAt: courses.startsAt,
      days: courses.days,
      endsAt: courses.endsAt,
      registrationDeadline: courses.registrationDeadline,
      maxCapacity: courses.maxCapacity,
      finalParticipants: courses.finalParticipants,
      price: courses.price,
      ageMin: courses.ageMin,
      ageMax: courses.ageMax,
      category: categories.name,
      categorySlug: categories.slug,
      instructorName: instructors.displayName,
    })
    .from(courses)
    .innerJoin(categories, eq(categories.id, courses.categoryId))
    .innerJoin(instructors, eq(instructors.id, courses.instructorId))
    .where(and(openWorkshopsWhere(now), category === undefined ? undefined : eq(categories.slug, category)))
    .orderBy(asc(courses.startsAt), asc(courses.id))
    .limit(limit)
  const [taken, files, showSeats] = await Promise.all([seatsTakenOf(rows.map((r) => r.id)), storage(), getSetting("showSeats")])

  return rows.map((r) => {
    const held = taken.get(r.id) ?? []
    const left = daySeatsLeft(r, held).total
    const seats: ShownSeats = showSeats ? { taken: sum(held), left } : null
    return {
      id: r.id,
      slug: r.slug,
      title: localized(r.title, locale),
      venue: localized(r.venue, locale),
      category: localized(r.category, locale),
      /** For a link to the category's list (/workshops?category=<slug>). */
      categorySlug: r.categorySlug,
      instructorName: profileText(r.instructorName, locale),
      coverUrl: urlOf(files, r.coverPath),
      startsAt: r.startsAt,
      days: r.days,
      endsAt: r.endsAt,
      registrationDeadline: r.registrationDeadline,
      price: r.price,
      maxCapacity: r.maxCapacity,
      seatsLeft: left,
      seats,
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
    .where(openWorkshopsWhere(now))
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
      days: courses.days,
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
        slug: instructors.slug,
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

  const [taken, samples, files, showSeats] = await Promise.all([
    seatsTakenByDay(row.id),
    db
      .select({ path: media.path, width: media.width, height: media.height })
      .from(media)
      .where(and(eq(media.courseId, row.id), eq(media.kind, "sample")))
      .orderBy(asc(media.sort), asc(media.createdAt)),
    storage(),
    getSetting("showSeats"),
  ])
  const seats = daySeatsLeft(row, taken)
  const left = seats.total
  const text = (value: Parameters<typeof localized>[0]) => localized(value, locale)
  const lang = (value: Parameters<typeof localized>[0]) => fallbackLanguage(value, locale)

  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    title: text(row.title),
    intro: text(row.intro),
    /** The intro in the page's language only (meta and JSON-LD descriptions never borrow another language's). */
    ownIntro: ownText(row.intro, locale),
    /**
     * The language of each text shown from another language (it has none in
     * this one), for a `lang` attribute around it; null: the page's own.
     */
    textLang: {
      intro: lang(row.intro),
      includes: lang(row.includes),
      bring: lang(row.bring),
      notes: lang(row.notes),
      experienceNote: lang(row.experienceNote),
      venue: lang(row.venue),
    },
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
    days: row.days,
    endsAt: row.endsAt,
    registrationDeadline: row.registrationDeadline,
    maxCapacity: row.maxCapacity,
    price: row.price,
    seatsLeft: left,
    /** Several days: the places left on each day (index = day), for choosing one. */
    daySeatsLeft: seats.days,
    /** Registered and left, in all and on each day; null when hidden from visitors. */
    seats: showSeats
      ? {
          taken: sum(taken),
          left,
          days: seats.days.map((n, i) => ({ taken: taken[i] ?? 0, left: n })),
        }
      : null,
    termsTemplateId: row.termsTemplateId,
    /** The online payment link, only when it is a safe https link (shown to registered students). */
    paymentUrl: safePaymentUrl(row.paymentUrl) ?? null,
    coverUrl: urlOf(files, row.coverPath),
    samples: samples.flatMap((s) => {
      const url = urlOf(files, s.path)
      return url ? [{ url, width: s.width, height: s.height }] : []
    }),
    instructor: {
      /** Their page: /instructors/<slug>. */
      slug: row.instructor.slug,
      name: profileText(row.instructor.displayName, locale),
      field: profileText(row.instructor.teachingField, locale),
      bio: profileText(row.instructor.bio, locale),
      fieldLang: profileLanguage(row.instructor.teachingField, locale),
      bioLang: profileLanguage(row.instructor.bio, locale),
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
