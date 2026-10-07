import "server-only"
import { asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm"
import { cache } from "react"

import { likePattern, type TableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { courses, members, registrations } from "@/db/schema"
import { normalizePhone } from "@/features/accounts/schema"
import { requireAdmin } from "@/lib/auth/admin"
import type { studentTable } from "./schema"

/**
 * Reads of the super admin's Students pages (the `members` table). Every one
 * starts with `requireAdmin()`; members' contact details never leave the panel.
 */

type Sort = (typeof studentTable.sort)[number]

/**
 * Number of registrations of the member, in every state (cancelled ones too).
 * Columns are qualified by hand: in a single-table select Drizzle prints bare
 * column names, which would resolve to `registrations` inside the subquery.
 */
const col = (table: typeof members | typeof registrations, column: { name: string }) =>
  sql`${table}.${sql.identifier(column.name)}`
const registrationCount = sql<number>`(select count(*)::int from ${registrations} where ${col(registrations, registrations.memberId)} = ${col(members, members.id)})`
const emailVerified = sql<boolean>`(${members.emailVerifiedAt} is not null)`

/** A stored phone without its "+90" or "0" in front: "+905321234567" and "05321234567" → "5321234567". */
const nationalPhone = sql`regexp_replace(${members.phone}, '^([+]90|0)', '')`

/**
 * Name or email, or a phone number as people type it. Phones are stored by
 * `normalizePhone` ("+90…", or "0…" as typed at sign up), so the search goes
 * through it too (spaces, dashes, brackets, Persian digits and direction
 * marks go; "00" becomes "+"), and a number typed with "+90", "0090", "90" or
 * "0" in front also matches by its national part, from the start: "0532 111
 * 99 88", "0090 532 111 99 88" and "+90 532…" all find "+905321119988" and
 * "05321119988".
 */
function search(q: string): SQL | undefined {
  if (!q) return undefined
  const pattern = likePattern(q)
  const phone = normalizePhone(q)
  const national = /^(?:\+90|90(?=\d{10}$)|0)(\d+)$/.exec(phone)?.[1]
  return or(
    ilike(members.name, pattern),
    ilike(members.email, pattern),
    phone ? ilike(members.phone, likePattern(phone)) : undefined,
    national ? ilike(nationalPhone, `${national}%`) : undefined,
  )
}

/** Students for the admin list: search (name, email, phone), sort, one page. */
export async function listStudents(params: TableParams<Sort, never>) {
  await requireAdmin()
  const where = search(params.q)
  const column =
    params.sort === "registrations" ? registrationCount : params.sort === "name" ? sql`lower(${members.name})` : members.createdAt
  const direction = params.dir === "desc" ? desc : asc

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        phone: members.phone,
        emailVerified,
        createdAt: members.createdAt,
        registrations: registrationCount,
      })
      .from(members)
      .where(where)
      .orderBy(direction(column), asc(members.email))
      .limit(params.pageSize)
      .offset(params.offset),
    db.select({ total: count() }).from(members).where(where),
  ])
  return { rows, total }
}

export type StudentRow = Awaited<ReturnType<typeof listStudents>>["rows"][number]

/** One student for the detail page, or null. Cached per request (the page and its metadata both ask). */
export const getStudent = cache(async (id: string) => {
  await requireAdmin()
  const [row] = await db
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      phone: members.phone,
      locale: members.locale,
      emailVerifiedAt: members.emailVerifiedAt,
      lockedUntil: members.lockedUntil,
      createdAt: members.createdAt,
      registrations: registrationCount,
    })
    .from(members)
    .where(eq(members.id, id))
    .limit(1)
  return row ?? null
})

export type Student = NonNullable<Awaited<ReturnType<typeof getStudent>>>

/** Every registration of the student (any state), the latest workshop first. */
export async function getStudentRegistrations(memberId: string) {
  await requireAdmin()
  return db
    .select({
      id: registrations.id,
      participantName: registrations.participantName,
      status: registrations.status,
      amount: registrations.amount,
      paymentMethod: registrations.paymentMethod,
      paidAt: registrations.paidAt,
      refundAmount: registrations.refundAmount,
      refundedAt: registrations.refundedAt,
      createdAt: registrations.createdAt,
      course: { id: courses.id, title: courses.title, startsAt: courses.startsAt },
    })
    .from(registrations)
    .innerJoin(courses, eq(courses.id, registrations.courseId))
    .where(eq(registrations.memberId, memberId))
    .orderBy(desc(courses.startsAt), desc(registrations.createdAt))
}

export type StudentRegistration = Awaited<ReturnType<typeof getStudentRegistrations>>[number]
