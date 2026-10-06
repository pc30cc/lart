import "server-only"
import { and, asc, count, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm"
import { cache } from "react"

import { likePattern, type TableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import {
  categories,
  contracts,
  courses,
  instructors,
  media,
  members,
  registrations,
  templates,
} from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { getStorage, type Storage } from "@/lib/storage"
import type { WorkshopView, workshopTable } from "./schema"

type Sort = (typeof workshopTable.sort)[number]
type Filter = keyof typeof workshopTable.filters

/** Storage for showing files, or null when the CDN settings are broken (the page still renders). */
async function storage(): Promise<Storage | null> {
  try {
    return await getStorage()
  } catch (err) {
    console.error("[workshops] storage unavailable", err)
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

/** Confirmed (paid) registrations of a course; qualified by hand (see categories/queries.ts). */
const qualified = (table: typeof courses | typeof registrations, column: { name: string }) =>
  sql`${table}.${sql.identifier(column.name)}`
const confirmedCount = sql<number>`(select count(*)::int from ${registrations} where ${qualified(registrations, registrations.courseId)} = ${qualified(courses, courses.id)} and ${qualified(registrations, registrations.status)} = 'confirmed')`

const active = ["awaiting_signature", "published", "confirmed"] as const

function viewCondition(view: WorkshopView): SQL | undefined {
  if (view === "all") return undefined
  if (view === "upcoming") return and(inArray(courses.status, [...active]), gte(courses.endsAt, sql`now()`))
  return eq(courses.status, view)
}

/** Workshops for the admin list: one tab (view), search, sort, one page. */
export async function listWorkshops(params: TableParams<Sort, Filter>, locale: string) {
  await requireAdmin()
  const view = (params.filters.view ?? "upcoming") as WorkshopView

  const conditions: (SQL | undefined)[] = [viewCondition(view)]
  if (params.q) {
    const pattern = likePattern(params.q)
    conditions.push(
      or(
        ...(["fa", "tr", "en"] as const).flatMap((l) => [
          ilike(sql`${courses.title}->>${l}`, pattern),
          ilike(sql`${instructors.displayName}->>${l}`, pattern),
        ]),
        ilike(courses.slug, pattern),
        ilike(courses.venue, pattern),
        ilike(instructors.officialName, pattern),
      ),
    )
  }
  const where = and(...conditions)

  const lang = locale === "fa" || locale === "en" ? locale : "tr"
  const title = sql`lower(coalesce(nullif(${courses.title}->>${lang}, ''), ${courses.title}->>'tr', ''))`
  const fill = sql`${confirmedCount}::float / ${courses.maxCapacity}`
  const column = { startsAt: courses.startsAt, title, fill, price: courses.price }[params.sort]
  const direction = params.dir === "desc" ? desc : asc

  const [rows, [{ total }], files] = await Promise.all([
    db
      .select({
        id: courses.id,
        status: courses.status,
        title: courses.title,
        coverPath: courses.coverPath,
        startsAt: courses.startsAt,
        endsAt: courses.endsAt,
        minCapacity: courses.minCapacity,
        maxCapacity: courses.maxCapacity,
        price: courses.price,
        category: categories.name,
        instructor: instructors.displayName,
        confirmed: confirmedCount,
      })
      .from(courses)
      .innerJoin(categories, eq(categories.id, courses.categoryId))
      .innerJoin(instructors, eq(instructors.id, courses.instructorId))
      .where(where)
      .orderBy(direction(column), asc(courses.startsAt), asc(courses.id))
      .limit(params.pageSize)
      .offset(params.offset),
    db
      .select({ total: count() })
      .from(courses)
      .innerJoin(instructors, eq(instructors.id, courses.instructorId))
      .where(where),
    storage(),
  ])
  return { view, rows: rows.map((r) => ({ ...r, coverUrl: urlOf(files, r.coverPath) })), total }
}

export type WorkshopRow = Awaited<ReturnType<typeof listWorkshops>>["rows"][number]

/** Number of workshops in each tab of the list. */
export async function countWorkshopViews(): Promise<Record<WorkshopView, number>> {
  await requireAdmin()
  const [row] = await db
    .select({
      all: count(),
      upcoming: sql<number>`count(*) filter (where ${viewCondition("upcoming")})::int`,
      awaiting_signature: sql<number>`count(*) filter (where ${courses.status} = 'awaiting_signature')::int`,
      published: sql<number>`count(*) filter (where ${courses.status} = 'published')::int`,
      confirmed: sql<number>`count(*) filter (where ${courses.status} = 'confirmed')::int`,
      cancelled: sql<number>`count(*) filter (where ${courses.status} = 'cancelled')::int`,
      closed: sql<number>`count(*) filter (where ${courses.status} = 'closed')::int`,
    })
    .from(courses)
  return row
}

/**
 * One workshop with everything the detail pages show: category, instructor
 * (private contact fields included: admins only), the current contract,
 * registration counts and the sample photos. Cached per request, so the
 * shared header and the page read it once.
 */
export const getWorkshop = cache(async (id: string) => {
  await requireAdmin()
  const [course] = await db
    .select({
      course: courses,
      category: { id: categories.id, name: categories.name },
      instructor: {
        id: instructors.id,
        displayName: instructors.displayName,
        officialName: instructors.officialName,
        email: instructors.email,
        mobile: instructors.mobile,
        active: instructors.active,
      },
      termsTemplate: templates.name,
    })
    .from(courses)
    .innerJoin(categories, eq(categories.id, courses.categoryId))
    .innerJoin(instructors, eq(instructors.id, courses.instructorId))
    .leftJoin(templates, eq(templates.id, courses.termsTemplateId))
    .where(eq(courses.id, id))
    .limit(1)
  if (!course) return null

  const [[contract], counts, samples, [gallery], files] = await Promise.all([
    // The current contract: the live one, or the last version when all are void.
    db
      .select({
        id: contracts.id,
        version: contracts.version,
        status: contracts.status,
        feeType: contracts.feeType,
        feeAmount: contracts.feeAmount,
        advanceAmount: contracts.advanceAmount,
        sentAt: contracts.sentAt,
        signedAt: contracts.signedAt,
        signedName: contracts.signedName,
      })
      .from(contracts)
      .where(eq(contracts.courseId, id))
      .orderBy(sql`${contracts.status} = 'void'`, desc(contracts.version))
      .limit(1),
    db
      .select({ status: registrations.status, n: count() })
      .from(registrations)
      .where(eq(registrations.courseId, id))
      .groupBy(registrations.status),
    db
      .select({ path: media.path, width: media.width, height: media.height })
      .from(media)
      .where(and(eq(media.courseId, id), eq(media.kind, "sample")))
      .orderBy(asc(media.sort), asc(media.createdAt)),
    db
      .select({ n: count() })
      .from(media)
      .where(and(eq(media.courseId, id), ne(media.kind, "sample"))),
    storage(),
  ])

  const registered = { pending: 0, confirmed: 0, cancelled: 0 }
  for (const c of counts) registered[c.status] = c.n
  return {
    ...course.course,
    category: course.category,
    instructor: course.instructor,
    termsTemplateName: course.termsTemplate,
    contract: contract ?? null,
    registered,
    galleryCount: gallery.n,
    coverUrl: urlOf(files, course.course.coverPath),
    samples: samples.map((s) => ({
      path: s.path,
      url: urlOf(files, s.path) ?? "",
      width: s.width ?? undefined,
      height: s.height ?? undefined,
      kind: "image" as const,
    })),
  }
})

export type Workshop = NonNullable<Awaited<ReturnType<typeof getWorkshop>>>

/** Choices for the workshop form. `instructorId`: keep the current instructor even if inactive. */
export async function getWorkshopFormOptions(instructorId?: string) {
  await requireAdmin()
  const [cats, people, terms, [contractTemplate]] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .orderBy(asc(categories.sort), asc(categories.slug)),
    db
      .select({ id: instructors.id, displayName: instructors.displayName, officialName: instructors.officialName })
      .from(instructors)
      .where(instructorId ? or(eq(instructors.active, true), eq(instructors.id, instructorId)) : eq(instructors.active, true))
      .orderBy(asc(instructors.officialName)),
    db
      .select({ id: templates.id, name: templates.name, isDefault: templates.isDefault })
      .from(templates)
      .where(eq(templates.kind, "terms"))
      .orderBy(desc(templates.isDefault), asc(templates.name)),
    db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.kind, "contract"), eq(templates.isDefault, true)))
      .limit(1),
  ])
  return { categories: cats, instructors: people, termsTemplates: terms, hasContractTemplate: Boolean(contractTemplate) }
}

export type WorkshopFormOptions = Awaited<ReturnType<typeof getWorkshopFormOptions>>

/** The registrations of a workshop with the member's contact details (read-only list). */
export async function listRegistrations(courseId: string) {
  await requireAdmin()
  return db
    .select({
      id: registrations.id,
      participantName: registrations.participantName,
      status: registrations.status,
      amount: registrations.amount,
      photoConsent: registrations.photoConsent,
      videoConsent: registrations.videoConsent,
      paidAt: registrations.paidAt,
      cancelledAt: registrations.cancelledAt,
      refundAmount: registrations.refundAmount,
      createdAt: registrations.createdAt,
      member: { name: members.name, email: members.email, phone: members.phone },
    })
    .from(registrations)
    .innerJoin(members, eq(members.id, registrations.memberId))
    .where(eq(registrations.courseId, courseId))
    .orderBy(sql`${registrations.status} = 'cancelled'`, asc(registrations.createdAt))
}

export type RegistrationRow = Awaited<ReturnType<typeof listRegistrations>>[number]

/** Gallery photos and videos of a workshop, in order, with their URLs. */
export async function listGallery(courseId: string) {
  await requireAdmin()
  const [rows, files] = await Promise.all([
    db
      .select({
        path: media.path,
        kind: media.kind,
        originalPath: media.originalPath,
        width: media.width,
        height: media.height,
      })
      .from(media)
      .where(and(eq(media.courseId, courseId), ne(media.kind, "sample")))
      .orderBy(asc(media.sort), asc(media.createdAt)),
    storage(),
  ])
  return rows.map((r) => ({
    path: r.path,
    url: urlOf(files, r.path) ?? "",
    kind: r.kind === "gallery_video" ? ("video" as const) : ("image" as const),
    originalPath: r.originalPath ?? undefined,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
  }))
}

/** Photo / video consent of the people who attended (confirmed registrations). */
export async function listConsents(courseId: string) {
  await requireAdmin()
  return db
    .select({
      id: registrations.id,
      participantName: registrations.participantName,
      photoConsent: registrations.photoConsent,
      videoConsent: registrations.videoConsent,
    })
    .from(registrations)
    .where(and(eq(registrations.courseId, courseId), eq(registrations.status, "confirmed")))
    .orderBy(asc(registrations.participantName))
}
