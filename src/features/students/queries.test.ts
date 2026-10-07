import { randomInt, randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { parseTableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { courses, members } from "@/db/schema"
import {
  addRegistration,
  createAdmin,
  createCategory,
  createInstructor,
  createMember,
  createTermsTemplate,
  runId,
} from "@/features/workshops/test-fixtures"
import { getStudent, getStudentRegistrations, listStudents } from "./queries"
import { studentTable } from "./schema"

const session = vi.hoisted(() => ({ sessionId: "test", admin: { id: "", email: "", name: "Students Tester", shareBp: 0 } }))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const run = runId()
const HOUR = 3_600_000
let refs: { categoryId: string; instructorId: string; termsId: string }

beforeAll(async () => {
  const [admin, category, instructor, terms] = await Promise.all([
    createAdmin(run, "Students Tester"),
    createCategory(run),
    createInstructor(run),
    createTermsTemplate(run),
  ])
  Object.assign(session.admin, { id: admin.id, email: admin.email })
  refs = { categoryId: category.id, instructorId: instructor.id, termsId: terms.id }
})

async function workshop(startsInHours: number, title: string) {
  const start = new Date(Date.now() + startsInHours * HOUR)
  const [row] = await db
    .insert(courses)
    .values({
      slug: `stu-${run}-${randomUUID().slice(0, 8)}`,
      status: "published",
      categoryId: refs.categoryId,
      instructorId: refs.instructorId,
      title: { tr: title, en: title },
      venue: { tr: "Atölye" },
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * HOUR),
      minCapacity: 2,
      maxCapacity: 10,
      price: 150_000,
      registrationDeadline: new Date(start.getTime() - HOUR),
      decisionAt: new Date(start.getTime() - 2 * HOUR),
      publishedAt: new Date(),
      createdBy: session.admin.id,
    })
    .returning()
  return row
}

const params = (q: Record<string, string>) =>
  parseTableParams(q, { sort: studentTable.sort, defaultSort: "createdAt", defaultDir: "desc" })

describe("students queries", () => {
  it("search by name, email or a phone typed with spaces", async () => {
    const m = await createMember(run, `Leyla ${run}`)
    await db.update(members).set({ phone: "+905321119988" }).where(eq(members.id, m.id))

    expect((await listStudents(params({ q: `leyla ${run}` }))).rows.map((r) => r.id)).toEqual([m.id])
    expect((await listStudents(params({ q: m.email.toUpperCase() }))).rows.map((r) => r.id)).toEqual([m.id])
    const byPhone = await listStudents(params({ q: "532 111 99 88" }))
    expect(byPhone.rows.map((r) => r.id)).toContain(m.id)
    expect(byPhone.total).toBeGreaterThanOrEqual(1)
    expect((await listStudents(params({ q: `nobody-${run}` }))).total).toBe(0)
  })

  it("search a phone however it is typed: 0, 0090, +90 or 90 in front, Persian digits, direction marks", async () => {
    const seven = () => String(randomInt(1_000_000, 5_000_000)) // never "53…", see the last check
    const [a, b] = [seven(), seven()]
    const spaced = (d: string) => `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5)}`
    const withPlus = await createMember(run, "Phone plus")
    const national = await createMember(run, "Phone national")
    await db.update(members).set({ phone: `+90532${a}` }).where(eq(members.id, withPlus.id))
    await db.update(members).set({ phone: `0533${b}` }).where(eq(members.id, national.id)) // as typed at sign up
    const found = async (q: string) => (await listStudents(params({ q }))).rows.map((r) => r.id)

    for (const q of [
      `532 ${spaced(a)}`,
      `0532 ${spaced(a)}`,
      `0090 532 ${spaced(a)}`,
      `+90 (532) ${spaced(a)}`,
      `90532${a}`,
      `\u200E+90 532 ${spaced(a)}\u200E`,
      `\u202A0532 ${spaced(a)}\u202C`,
      `۰۵۳۲ ${spaced(a).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)])}`,
    ]) {
      expect(await found(q), q).toEqual([withPlus.id])
    }
    for (const q of [`533 ${spaced(b)}`, `0533${b}`, `+90 533 ${spaced(b)}`, `0090 533 ${spaced(b)}`, `90533${b}`]) {
      expect(await found(q), q).toEqual([national.id])
    }
    // A "0" in front means the number starts there: "0" and the last seven digits is not it.
    expect(await found(`0${a}`)).not.toContain(withPlus.id)
  })

  it("count every registration and sort by them; say when the email is not confirmed", async () => {
    const tag = `Count ${run}`
    const [none, two] = [await createMember(run, `${tag} none`), await createMember(run, `${tag} two`)]
    await db.update(members).set({ emailVerifiedAt: new Date() }).where(eq(members.id, two.id))
    const [a, b] = [await workshop(48, "A"), await workshop(72, "B")]
    await addRegistration(a.id, two.id, refs.termsId)
    await addRegistration(b.id, two.id, refs.termsId, { status: "cancelled" })

    const { rows, total } = await listStudents(params({ q: tag, sort: "registrations", dir: "desc" }))
    expect(total).toBe(2)
    expect(rows).toMatchObject([
      { id: two.id, registrations: 2, emailVerified: true },
      { id: none.id, registrations: 0, emailVerified: false },
    ])
    const ascending = await listStudents(params({ q: tag, sort: "registrations", dir: "asc" }))
    expect(ascending.rows.map((r) => r.id)).toEqual([none.id, two.id])
  })

  it("getStudent gives one student, or null", async () => {
    const m = await createMember(run, "Detail")
    expect(await getStudent(m.id)).toMatchObject({ id: m.id, name: "Detail", email: m.email, registrations: 0 })
    expect(await getStudent(randomUUID())).toBeNull()
  })

  it("getStudentRegistrations lists the student's registrations with the workshop and payment, latest workshop first", async () => {
    const m = await createMember(run, "Regs")
    const [soon, later] = [await workshop(24, `Soon ${run}`), await workshop(24 * 30, `Later ${run}`)]
    const paid = await addRegistration(soon.id, m.id, refs.termsId, { status: "confirmed", amount: 150_000 })
    const pending = await addRegistration(later.id, m.id, refs.termsId, { status: "pending" })
    const other = await createMember(run, "Other")
    await addRegistration(soon.id, other.id, refs.termsId)

    const list = await getStudentRegistrations(m.id)
    expect(list).toMatchObject([
      { id: pending.id, status: "pending", paidAt: null, course: { id: later.id, title: { en: `Later ${run}` } } },
      { id: paid.id, status: "confirmed", amount: 150_000, paymentMethod: null, course: { id: soon.id } },
    ])
    expect(list[1].paidAt).toBeInstanceOf(Date)
    expect(list[0]).toHaveProperty("participantName", "Participant")
  })
})
