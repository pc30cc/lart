import "server-only"
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm"
import { cache } from "react"

import { likePattern, type TableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { contracts, courses, emailTokens, instructors } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { decrypt } from "@/lib/crypto"
import { errorForLog } from "@/lib/errors"
import { getStorage, type Storage } from "@/lib/storage"
import { maskIdNumber, type instructorTable } from "./schema"

type Sort = (typeof instructorTable.sort)[number]
type Filter = keyof typeof instructorTable.filters

/**
 * Number of workshops of the instructor (any status). Columns are qualified by
 * hand: in a single-table select Drizzle prints bare column names, which would
 * resolve to `courses` inside the subquery.
 */
const col = (table: typeof courses | typeof contracts | typeof instructors, column: { name: string }) =>
  sql`${table}.${sql.identifier(column.name)}`
const workshops = sql<number>`(select count(*)::int from ${courses} where ${col(courses, courses.instructorId)} = ${col(instructors, instructors.id)})`
const hasPassword = sql<boolean>`(${instructors.passwordHash} is not null)`
const approved = sql<boolean>`(${instructors.approvedAt} is not null)`

/** Public URL of a stored photo, or null (also when the storage setting is broken). */
function photoUrl(storage: Storage | null, path: string | null): string | null {
  if (!storage || !path) return null
  try {
    return storage.publicUrl(path)
  } catch {
    return null
  }
}

async function storageOrNull(): Promise<Storage | null> {
  try {
    return await getStorage()
  } catch (err) {
    console.error("[instructors] storage unavailable", errorForLog(err))
    return null
  }
}

/** Instructors for the admin list: search (name, email), filter by status, sort, one page. */
export async function listInstructors(params: TableParams<Sort, Filter>, locale: string) {
  await requireAdmin()

  const conditions: (SQL | undefined)[] = []
  if (params.q) {
    const pattern = likePattern(params.q)
    conditions.push(
      or(
        ilike(sql`${instructors.displayName}->>'fa'`, pattern),
        ilike(sql`${instructors.displayName}->>'tr'`, pattern),
        ilike(sql`${instructors.displayName}->>'en'`, pattern),
        ilike(instructors.officialName, pattern),
        ilike(instructors.email, pattern),
      ),
    )
  }
  // The states of the status badge: waiting for approval (signed up on their own),
  // active (has a password), invited (no password yet), inactive.
  const { status } = params.filters
  const isApproved = isNotNull(instructors.approvedAt)
  if (status === "inactive") conditions.push(eq(instructors.active, false))
  if (status === "pending") conditions.push(and(eq(instructors.active, true), isNull(instructors.approvedAt)))
  if (status === "active") conditions.push(and(eq(instructors.active, true), isApproved, isNotNull(instructors.passwordHash)))
  if (status === "invited") conditions.push(and(eq(instructors.active, true), isApproved, isNull(instructors.passwordHash)))
  const where = and(...conditions)

  // Same fallback as the site: Persian shows the English name when there is no Persian one.
  const lang = locale === "fa" || locale === "en" ? locale : "tr"
  const fallback = lang === "en" ? "tr" : "en"
  const name = sql`lower(coalesce(nullif(${instructors.displayName}->>${lang}, ''), ${instructors.displayName}->>${fallback}, ''))`
  const column = params.sort === "workshops" ? workshops : name
  const direction = params.dir === "desc" ? desc : asc

  const [rows, [{ total }], storage] = await Promise.all([
    db
      .select({
        id: instructors.id,
        email: instructors.email,
        displayName: instructors.displayName,
        teachingField: instructors.teachingField,
        teachingLanguages: instructors.teachingLanguages,
        photoPath: instructors.photoPath,
        active: instructors.active,
        approved,
        hasPassword,
        workshops,
      })
      .from(instructors)
      .where(where)
      .orderBy(direction(column), asc(instructors.email))
      .limit(params.pageSize)
      .offset(params.offset),
    db.select({ total: count() }).from(instructors).where(where),
    storageOrNull(),
  ])
  return {
    rows: rows.map(({ photoPath, ...row }) => ({ ...row, photoUrl: photoUrl(storage, photoPath) })),
    total,
  }
}

/** How many active instructors signed up on their own and wait for approval. */
export async function countPendingInstructors(): Promise<number> {
  await requireAdmin()
  const [{ total }] = await db
    .select({ total: count() })
    .from(instructors)
    .where(and(eq(instructors.active, true), isNull(instructors.approvedAt)))
  return total
}

export type InstructorRow = Awaited<ReturnType<typeof listInstructors>>["rows"][number]

/**
 * One instructor for the detail and edit pages, or null. The ID number is
 * only returned masked; `revealIdNumber` (audited) shows it in full.
 * Cached per request (the page and its metadata both ask).
 */
export const getInstructor = cache(async (id: string) => {
  await requireAdmin()
  const [row] = await db
    .select({
      id: instructors.id,
      email: instructors.email,
      officialName: instructors.officialName,
      idNumberEnc: instructors.idNumberEnc,
      mobile: instructors.mobile,
      displayName: instructors.displayName,
      teachingField: instructors.teachingField,
      bio: instructors.bio,
      teachingLanguages: instructors.teachingLanguages,
      website: instructors.website,
      photoPath: instructors.photoPath,
      active: instructors.active,
      approved,
      hasPassword,
      emailVerifiedAt: instructors.emailVerifiedAt,
      createdAt: instructors.createdAt,
      workshops,
      contracts: sql<number>`(select count(*)::int from ${contracts} where ${col(contracts, contracts.instructorId)} = ${col(instructors, instructors.id)})`,
    })
    .from(instructors)
    .where(eq(instructors.id, id))
    .limit(1)
  if (!row) return null

  const { idNumberEnc, ...rest } = row
  let idNumberMasked: string | null = null
  try {
    idNumberMasked = maskIdNumber(decrypt(idNumberEnc))
  } catch (err) {
    console.error("[instructors] cannot decrypt the ID number of", id, errorForLog(err))
  }

  const [invite] = await db
    .select({ sentAt: emailTokens.createdAt, expiresAt: emailTokens.expiresAt })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.kind, "instructor"),
        eq(emailTokens.subjectId, id),
        eq(emailTokens.purpose, "invite"),
        isNull(emailTokens.usedAt),
      ),
    )
    .orderBy(desc(emailTokens.createdAt))
    .limit(1)

  return {
    ...rest,
    idNumberMasked,
    photoUrl: photoUrl(await storageOrNull(), rest.photoPath),
    /** The latest unused invitation (it may have expired). */
    invite: invite ?? null,
  }
})

export type InstructorDetail = NonNullable<Awaited<ReturnType<typeof getInstructor>>>

/** The instructor's workshops, newest first (read-only list on the detail page). */
export async function getInstructorWorkshops(id: string) {
  await requireAdmin()
  return db
    .select({ id: courses.id, title: courses.title, startsAt: courses.startsAt, status: courses.status })
    .from(courses)
    .where(eq(courses.instructorId, id))
    .orderBy(desc(courses.startsAt))
}

/** The instructor's contracts with their workshop, newest first. */
export async function getInstructorContracts(id: string) {
  await requireAdmin()
  return db
    .select({
      id: contracts.id,
      courseId: contracts.courseId,
      workshopTitle: courses.title,
      version: contracts.version,
      status: contracts.status,
      sentAt: contracts.sentAt,
      signedAt: contracts.signedAt,
    })
    .from(contracts)
    .innerJoin(courses, eq(courses.id, contracts.courseId))
    .where(eq(contracts.instructorId, id))
    .orderBy(desc(contracts.sentAt), desc(contracts.version))
}

/**
 * For selects in other modules (e.g. the workshop form): active, approved
 * instructors, plus `includeId` even when not (the one already chosen on a record).
 * Name them with `profileText(option.displayName, locale)`.
 */
export async function getInstructorOptions({ includeId }: { includeId?: string | null } = {}) {
  await requireAdmin()
  const available = and(eq(instructors.active, true), isNotNull(instructors.approvedAt))
  const visible = includeId ? or(available, inArray(instructors.id, [includeId])) : available
  return db
    .select({
      id: instructors.id,
      displayName: instructors.displayName,
      teachingField: instructors.teachingField,
      active: instructors.active,
    })
    .from(instructors)
    .where(visible)
    .orderBy(asc(sql`lower(${instructors.displayName}->>'tr')`))
}

export type InstructorOption = Awaited<ReturnType<typeof getInstructorOptions>>[number]

/**
 * The private fields a contract needs, with the ID number DECRYPTED.
 * Server-only, for admin code (the contracts module). Never send the result
 * to the browser or the public site, and never write it to the audit log.
 */
export async function getInstructorForContract(id: string) {
  await requireAdmin()
  const [row] = await db
    .select({
      id: instructors.id,
      officialName: instructors.officialName,
      idNumberEnc: instructors.idNumberEnc,
      mobile: instructors.mobile,
      email: instructors.email,
      displayName: instructors.displayName,
      active: instructors.active,
    })
    .from(instructors)
    .where(eq(instructors.id, id))
    .limit(1)
  if (!row) return null
  const { idNumberEnc, ...rest } = row
  return { ...rest, idNumber: decrypt(idNumberEnc) }
}

export type InstructorForContract = NonNullable<Awaited<ReturnType<typeof getInstructorForContract>>>
