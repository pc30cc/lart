import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { parseTableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import {
  admins,
  auditLog,
  categories,
  contracts,
  courses,
  emailTokens,
  instructors,
  sessions,
  templates,
} from "@/db/schema"
import { renderEmail } from "@/emails"
import { decrypt, sha256 } from "@/lib/crypto"
import {
  approveInstructor,
  createInstructor,
  deleteInstructor,
  resendInvite,
  revealIdNumber,
  setInstructorActive,
  updateInstructor,
} from "./actions"
import {
  getInstructor,
  getInstructorContracts,
  getInstructorForContract,
  getInstructorOptions,
  countPendingInstructors,
  getInstructorWorkshops,
  listInstructors,
} from "./queries"
import { instructorTable, type InstructorFormValues } from "./schema"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    instructors: (await import("../../../messages/en/instructors.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

const session = vi.hoisted(() => ({
  sessionId: "test",
  admin: { id: "", email: "", name: "Instructor Tester", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const sendEmail = vi.hoisted(() =>
  vi.fn<(input: unknown) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })),
)
vi.mock("@/lib/email", () => ({ sendEmail }))

const storage = vi.hoisted(() => ({ remove: vi.fn<(path: string) => Promise<void>>(async () => {}) }))
vi.mock("@/lib/storage", () => ({
  remove: storage.remove,
  getStorage: async () => ({ publicUrl: (path: string) => `/media/${path}` }),
}))

const run = randomUUID().slice(0, 8)
const created: string[] = []
const extra = { categoryId: "", templateId: "", courseIds: [] as string[], contractIds: [] as string[] }

function values(label: string, overrides: Partial<InstructorFormValues> = {}): InstructorFormValues {
  return {
    displayName: { fa: "", tr: `${label} ${run}`, en: `${label} EN ${run}` },
    teachingField: { fa: "", tr: "Seramik", en: "Ceramics" },
    officialName: `  ${label}   Official  `,
    idNumber: "123 4567 8901",
    mobile: "+90 (532) 123 45 67",
    email: `${label}-${run}@Test.Local`,
    bio: { fa: "", tr: "", en: "" },
    teachingLanguages: ["tr", "en", "tr"],
    website: "@elif.art",
    photoPath: null,
    inviteLocale: "tr",
    ...overrides,
  }
}

async function create(label: string, overrides: Partial<InstructorFormValues> = {}) {
  const result = await createInstructor(values(label, overrides))
  if (!result.ok) throw new Error(`${result.error} ${JSON.stringify(result.fieldErrors)}`)
  created.push(result.data.id)
  return result.data.id
}

const row = async (id: string) => (await db.select().from(instructors).where(eq(instructors.id, id)))[0]
const tokens = (id: string) =>
  db
    .select()
    .from(emailTokens)
    .where(and(eq(emailTokens.kind, "instructor"), eq(emailTokens.subjectId, id)))
const audits = (id: string) =>
  db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, "instructor"), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.at))
/** The token in the link of the last invitation email. */
function lastInviteLink() {
  const input = sendEmail.mock.calls.at(-1)![0] as { props: { acceptUrl: string } }
  return new URL(input.props.acceptUrl)
}

beforeAll(async () => {
  const [admin] = await db
    .insert(admins)
    .values({ email: `instr-${run}@test.local`, name: "Instructor Tester", passwordHash: "x" })
    .returning()
  session.admin.id = admin.id
  session.admin.email = admin.email
  const [category] = await db
    .insert(categories)
    .values({ slug: `instr-cat-${run}`, name: { tr: "Kategori" } })
    .returning()
  extra.categoryId = category.id
  const [template] = await db
    .insert(templates)
    .values({ kind: "contract", name: `Contract ${run}`, body: { tr: "Metin" } })
    .returning()
  extra.templateId = template.id
})

beforeEach(() => {
  sendEmail.mockClear()
  storage.remove.mockClear()
})

afterAll(async () => {
  if (extra.contractIds.length) await db.delete(contracts).where(inArray(contracts.id, extra.contractIds))
  if (extra.courseIds.length) await db.delete(courses).where(inArray(courses.id, extra.courseIds))
  await db.delete(templates).where(eq(templates.id, extra.templateId))
  await db.delete(categories).where(eq(categories.id, extra.categoryId))
  if (created.length) {
    await db.delete(emailTokens).where(inArray(emailTokens.subjectId, created))
    await db.delete(sessions).where(inArray(sessions.subjectId, created))
    await db.delete(instructors).where(inArray(instructors.id, created))
  }
})

async function addCourse(instructorId: string) {
  const start = new Date(Date.now() + 7 * 86_400_000)
  const [course] = await db
    .insert(courses)
    .values({
      slug: `instr-course-${randomUUID()}`,
      categoryId: extra.categoryId,
      instructorId,
      title: { tr: `Atölye ${run}` },
      venue: { tr: "Studio" },
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * 3_600_000),
      minCapacity: 3,
      maxCapacity: 10,
      price: 150000,
      registrationDeadline: start,
      decisionAt: start,
      createdBy: session.admin.id,
    })
    .returning({ id: courses.id })
  extra.courseIds.push(course.id)
  return course.id
}

async function addContract(courseId: string, instructorId: string) {
  const [contract] = await db
    .insert(contracts)
    .values({ courseId, instructorId, templateId: extra.templateId, feeType: "fixed", feeAmount: 500000 })
    .returning({ id: contracts.id })
  extra.contractIds.push(contract.id)
}

describe("createInstructor", () => {
  it("stores the ID number encrypted, normalises the fields and audits without private data", async () => {
    const id = await create("elif", { bio: { fa: "", tr: "", en: "Hello" } })
    const saved = await row(id)
    expect(saved).toMatchObject({
      email: `elif-${run}@test.local`,
      officialName: "elif Official",
      mobile: "+905321234567",
      teachingLanguages: ["tr", "en"],
      website: "https://www.instagram.com/elif.art",
      bio: { en: "Hello" },
      active: true,
      passwordHash: null,
    })
    expect(saved.displayName).toEqual({ tr: `elif ${run}`, en: `elif EN ${run}` })
    expect(saved.idNumberEnc).not.toContain("12345678901")
    expect(saved.idNumberEnc).toMatch(/^v1\./)
    expect(decrypt(saved.idNumberEnc)).toBe("12345678901")

    const entries = await audits(id)
    expect(entries.map((e) => e.action)).toEqual(["instructor.create", "instructor.invite"])
    expect(entries[0].adminId).toBe(session.admin.id)
    expect(entries[1].data).toEqual({ locale: "tr", sent: true })
    const logged = JSON.stringify(entries.map((e) => e.data))
    for (const secret of ["12345678901", "Official", "+905321234567", "test.local", "idNumberEnc"]) {
      expect(logged).not.toContain(secret)
    }
  })

  it("creates a one-time invitation token (hash only, 7 days) and emails its link", async () => {
    const before = Date.now()
    const id = await create("deniz", { inviteLocale: "fa" })
    // The invitation's language is the instructor's until they choose one: contract emails use it.
    expect((await row(id)).locale).toBe("fa")
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const input = sendEmail.mock.calls[0][0] as { to: string; template: string; locale: string; props: { name: string } }
    expect(input).toMatchObject({ to: `deniz-${run}@test.local`, template: "instructor_invite", locale: "fa" })
    // Persian has no display name: the English one is used.
    expect(input.props.name).toBe(`deniz EN ${run}`)

    const link = lastInviteLink()
    expect(link.origin).toBe(new URL(process.env.APP_URL!).origin)
    expect(link.pathname).toBe("/fa/instructor/invite")
    const token = link.searchParams.get("token")!
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const [stored, ...others] = await tokens(id)
    expect(others).toHaveLength(0)
    expect(stored).toMatchObject({ id: sha256(token), purpose: "invite", kind: "instructor", usedAt: null })
    expect(stored.id).not.toBe(token)
    const ttl = stored.expiresAt.getTime() - before
    expect(ttl).toBeGreaterThan(7 * 86_400_000 - 60_000)
    expect(ttl).toBeLessThan(7 * 86_400_000 + 60_000)

    // The real template accepts the link (it must be on this site) and shows it.
    const email = await renderEmail("instructor_invite", input.props as never, "fa")
    expect(email.html).toContain(token)
  })

  it("without a chosen language, invites (and stores) the admin's own language", async () => {
    const id = await create("kaan", { inviteLocale: undefined })
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ locale: "en" })
    expect((await row(id)).locale).toBe("en")
  })

  it("still creates the instructor when the email can't be sent, and says so", async () => {
    sendEmail.mockResolvedValueOnce({ ok: false, error: "down" })
    const result = await createInstructor(values("ozan"))
    expect(result).toMatchObject({ ok: true, data: { invited: false } })
    if (!result.ok) return
    created.push(result.data.id)
    expect((await audits(result.data.id)).at(-1)?.data).toEqual({ locale: "tr", sent: false })
  })

  it("refuses an email that is already used, whatever its case", async () => {
    await create("selin")
    const message = "Another instructor already uses this email address."
    const result = await createInstructor(values("other", { email: ` SELIN-${run}@TEST.local ` }))
    expect(result).toEqual({ ok: false, error: message, fieldErrors: { email: message } })

    // An older row stored with capitals is matched too.
    const [legacy] = await db
      .insert(instructors)
      .values({
        email: `Mixed-${run}@Test.Local`,
        officialName: "Legacy",
        idNumberEnc: "v1.x.x.x",
        mobile: "+905000000000",
        displayName: { tr: "Legacy", en: "Legacy" },
        teachingField: { tr: "Mum", en: "Candles" },
      })
      .returning({ id: instructors.id })
    created.push(legacy.id)
    expect(await createInstructor(values("x", { email: `mixed-${run}@test.local` }))).toMatchObject({
      ok: false,
      fieldErrors: { email: message },
    })
  })

  it("validates every field with friendly messages", async () => {
    const result = await createInstructor(
      values("bad", {
        idNumber: "",
        mobile: "0532 123 45 67",
        website: "http://example.com",
        photoPath: "../../etc/passwd",
        displayName: { fa: "", tr: "", en: "Only English" },
        teachingLanguages: ["xx" as never],
      }),
    )
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        idNumber: "Please fill this in.",
        mobile: "Please enter the number with its country code, like +90 532 123 45 67.",
        website: "Please enter a full web address, like https://example.com.",
        photoPath: "This photo couldn’t be saved. Please upload it again.",
        "displayName.tr": "Please fill this in.",
        "teachingLanguages.0": "Please choose one of the options.",
      },
    })
    const wrongPrefix = await createInstructor(values("bad", { photoPath: "courses/2026-10/abcdefghijklmnop.webp" }))
    expect(wrongPrefix).toMatchObject({ ok: false, fieldErrors: { photoPath: expect.any(String) } })
    const shortId = await createInstructor(values("bad", { idNumber: "12" }))
    expect(shortId).toMatchObject({
      ok: false,
      fieldErrors: { idNumber: "Please use 5 to 20 letters and numbers, without spaces." },
    })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe("updateInstructor", () => {
  it("keeps the ID number when left empty, re-encrypts a new one and audits only field names", async () => {
    const id = await create("zeynep")
    const { idNumberEnc } = await row(id)

    const same = await updateInstructor({ ...values("zeynep"), id, idNumber: "" })
    expect(same).toEqual({ ok: true, data: { id, inviteCancelled: false } })
    expect((await row(id)).idNumberEnc).toBe(idNumberEnc)
    // Nothing changed: no audit entry.
    expect((await audits(id)).map((e) => e.action)).toEqual(["instructor.create", "instructor.invite"])

    // The same number typed again is not a change either.
    await updateInstructor({ ...values("zeynep"), id, idNumber: "12345678901" })
    expect((await row(id)).idNumberEnc).toBe(idNumberEnc)

    await updateInstructor({
      ...values("zeynep"),
      id,
      idNumber: "u 1234567",
      mobile: "0090 555 111 22 33",
      teachingField: { fa: "سفال", tr: "Seramik", en: "Ceramics" },
    })
    const saved = await row(id)
    expect(decrypt(saved.idNumberEnc)).toBe("U1234567")
    expect(saved.mobile).toBe("+905551112233")
    const audit = (await audits(id)).at(-1)!
    expect(audit.action).toBe("instructor.update")
    expect(audit.data).toEqual({
      teachingField: { from: { tr: "Seramik", en: "Ceramics" }, to: { fa: "سفال", tr: "Seramik", en: "Ceramics" } },
      privateFields: ["mobile", "idNumber"],
    })
    expect(JSON.stringify(audit.data)).not.toContain("U1234567")
  })

  it("cancels pending links when the email changes and asks for verification again", async () => {
    const id = await create("mina")
    await db.update(instructors).set({ emailVerifiedAt: new Date() }).where(eq(instructors.id, id))
    expect(await tokens(id)).toHaveLength(1)

    const result = await updateInstructor({ ...values("mina"), id, email: `mina-new-${run}@test.local` })
    expect(result).toEqual({ ok: true, data: { id, inviteCancelled: true } })
    expect(await tokens(id)).toHaveLength(0)
    expect(await row(id)).toMatchObject({ email: `mina-new-${run}@test.local`, emailVerifiedAt: null })
    expect((await audits(id)).at(-1)?.data).toEqual({ privateFields: ["email"] })
  })

  it("refuses another instructor's email and a missing instructor", async () => {
    await create("aylin")
    const id = await create("burcu")
    expect(await updateInstructor({ ...values("burcu"), id, email: `AYLIN-${run}@test.local` })).toMatchObject({
      ok: false,
      fieldErrors: { email: "Another instructor already uses this email address." },
    })
    expect(await updateInstructor({ ...values("ghost"), id: randomUUID() })).toEqual({
      ok: false,
      error: "This instructor no longer exists. They may have just been deleted.",
    })
  })

  it("removes the old photo from storage after replacing it", async () => {
    const oldPhoto = `instructors/2026-10/${"a".repeat(22)}.webp`
    const newPhoto = `instructors/2026-10/${"b".repeat(22)}.webp`
    const id = await create("photo", { photoPath: oldPhoto })
    await updateInstructor({ ...values("photo"), id, photoPath: newPhoto })
    expect(storage.remove).toHaveBeenCalledWith(oldPhoto)
    expect((await row(id)).photoPath).toBe(newPhoto)
  })
})

describe("ID number reveal", () => {
  it("returns the full number, audits the reveal, and lists show it masked only", async () => {
    const id = await create("reveal", { idNumber: "98765432109" })
    expect(await revealIdNumber({ id })).toEqual({ ok: true, data: { idNumber: "98765432109" } })
    expect((await audits(id)).at(-1)).toMatchObject({ action: "instructor.reveal_id", data: null })

    const detail = await getInstructor(id)
    expect(detail?.idNumberMasked).toBe("••••••109")
    expect(JSON.stringify(detail)).not.toContain("98765432109")
    expect(detail).not.toHaveProperty("idNumberEnc")

    const contract = await getInstructorForContract(id)
    expect(contract).toMatchObject({ idNumber: "98765432109", officialName: "reveal Official", mobile: "+905321234567" })
  })
})

describe("resendInvite", () => {
  it("replaces the previous link with a new one in the chosen language", async () => {
    const id = await create("hande")
    expect((await row(id)).locale).toBe("tr")
    const [first] = await tokens(id)
    expect(await resendInvite({ id, locale: "en" })).toEqual({ ok: true, data: { id } })
    // They haven't accepted yet, so their emails (e.g. contracts) follow the new invitation's language.
    expect((await row(id)).locale).toBe("en")
    const link = lastInviteLink()
    expect(link.pathname).toBe("/en/instructor/invite")
    const live = await tokens(id)
    expect(live).toHaveLength(1)
    expect(live[0].id).not.toBe(first.id)
    expect(live[0].id).toBe(sha256(link.searchParams.get("token")!))
    expect((await audits(id)).at(-1)).toMatchObject({ action: "instructor.invite", data: { locale: "en", sent: true } })
  })

  it("is refused once a password is set, or while the instructor is inactive", async () => {
    const id = await create("set")
    await db.update(instructors).set({ passwordHash: "hash", locale: "fa" }).where(eq(instructors.id, id))
    expect(await resendInvite({ id, locale: "tr" })).toEqual({
      ok: false,
      error: "This instructor has already set a password, so they don’t need an invitation.",
    })
    // The language they chose themselves is kept.
    expect((await row(id)).locale).toBe("fa")
    const inactive = await create("sleepy")
    await setInstructorActive({ id: inactive, active: false })
    expect(await resendInvite({ id: inactive, locale: "tr" })).toMatchObject({ ok: false })
  })

  it("reports an email that could not be sent", async () => {
    const id = await create("fail")
    sendEmail.mockResolvedValueOnce({ ok: false, error: "down" })
    expect(await resendInvite({ id, locale: "tr" })).toEqual({
      ok: false,
      error: "We couldn’t send the invitation email. Please try again in a moment.",
    })
  })
})

describe("deactivate, activate and delete", () => {
  it("deactivating signs the instructor out and voids emailed links; activating audits too", async () => {
    const id = await create("leyla")
    await db
      .insert(sessions)
      .values({ id: sha256(randomUUID()), kind: "instructor", subjectId: id, expiresAt: new Date(Date.now() + 3_600_000) })

    expect(await setInstructorActive({ id, active: false })).toEqual({ ok: true, data: { id, active: false } })
    expect((await row(id)).active).toBe(false)
    expect(await db.select().from(sessions).where(eq(sessions.subjectId, id))).toHaveLength(0)
    expect(await tokens(id)).toHaveLength(0)

    // Same state again: nothing to audit.
    await setInstructorActive({ id, active: false })
    await setInstructorActive({ id, active: true })
    expect((await audits(id)).map((e) => e.action).slice(-2)).toEqual(["instructor.deactivate", "instructor.activate"])
    expect((await row(id)).active).toBe(true)
  })

  it("refuses to delete an instructor with workshops or contracts", async () => {
    const withCourse = await create("busy")
    await addCourse(withCourse)
    const message = "This instructor has workshops or contracts, so they can’t be deleted. You can deactivate them instead."
    expect(await deleteInstructor({ id: withCourse })).toEqual({ ok: false, error: message })

    // A contract alone (its workshop moved to another instructor) also blocks it.
    const withContract = await create("signed")
    await addContract(await addCourse(withCourse), withContract)
    expect(await deleteInstructor({ id: withContract })).toEqual({ ok: false, error: message })
    expect(await row(withContract)).toBeDefined()

    const workshops = await getInstructorWorkshops(withCourse)
    expect(workshops).toHaveLength(2)
    expect(workshops[0]).toMatchObject({ status: "awaiting_signature", title: { tr: `Atölye ${run}` } })
    const list = await getInstructorContracts(withContract)
    expect(list).toEqual([expect.objectContaining({ version: 1, status: "sent", signedAt: null })])
    expect((await getInstructor(withCourse))?.workshops).toBe(2)
    expect((await getInstructor(withContract))?.contracts).toBe(1)
  })

  it("deletes an instructor without workshops, with their tokens and photo", async () => {
    const photo = `instructors/2026-10/${"c".repeat(22)}.webp`
    const id = await create("gone", { photoPath: photo })
    expect(await deleteInstructor({ id })).toEqual({ ok: true, data: { id } })
    expect(await row(id)).toBeUndefined()
    expect(await tokens(id)).toHaveLength(0)
    expect(storage.remove).toHaveBeenCalledWith(photo)
    expect((await audits(id)).at(-1)).toMatchObject({ action: "instructor.delete", data: { displayName: expect.any(Object) } })
    expect(await deleteInstructor({ id })).toMatchObject({ ok: false })
  })

  it("rejects a malformed id", async () => {
    expect(await deleteInstructor({ id: "../etc" })).toMatchObject({ ok: false })
    expect(await setInstructorActive({ id: "x", active: false })).toMatchObject({ ok: false })
  })
})

describe("queries", () => {
  it("lists with search by name or email, status filters and photo URLs", async () => {
    const parse = (sp: Record<string, string>) =>
      parseTableParams(sp, { sort: instructorTable.sort, defaultSort: "name", filters: instructorTable.filters })

    const photo = `instructors/2026-10/${"d".repeat(22)}.webp`
    const id = await create("listed", { photoPath: photo })
    const all = await listInstructors(parse({ q: run }), "en")
    expect(all.total).toBe(all.rows.length)
    expect(all.rows.find((r) => r.id === id)).toMatchObject({
      photoUrl: `/media/${photo}`,
      hasPassword: false,
      workshops: 0,
      teachingLanguages: ["tr", "en"],
    })
    expect(all.rows[0]).not.toHaveProperty("idNumberEnc")
    expect(all.rows[0]).not.toHaveProperty("mobile")

    const byEmail = await listInstructors(parse({ q: `listed-${run}@` }), "en")
    expect(byEmail.rows.map((r) => r.id)).toEqual([id])

    const inactive = await listInstructors(parse({ q: run, status: "inactive" }), "en")
    expect(inactive.rows.every((r) => !r.active)).toBe(true)
    const invited = await listInstructors(parse({ q: run, status: "invited" }), "en")
    expect(invited.rows.every((r) => r.active && !r.hasPassword)).toBe(true)
    expect(invited.rows.map((r) => r.id)).toContain(id)
    const active = await listInstructors(parse({ q: run, status: "active" }), "en")
    expect(active.rows.length).toBeGreaterThan(0)
    expect(active.rows.every((r) => r.active && r.hasPassword)).toBe(true)

    const byWorkshops = await listInstructors(parse({ q: run, sort: "workshops", dir: "desc" }), "en")
    const counts = byWorkshops.rows.map((r) => r.workshops)
    expect(counts[0]).toBeGreaterThan(0)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
  })

  it("offers active instructors for selects, plus the one already chosen", async () => {
    const id = await create("option")
    await setInstructorActive({ id, active: false })
    expect((await getInstructorOptions()).map((o) => o.id)).not.toContain(id)
    const withChosen = await getInstructorOptions({ includeId: id })
    expect(withChosen.find((o) => o.id === id)).toMatchObject({ active: false, displayName: expect.any(Object) })
  })
})

describe("approval of self-registered instructors", () => {
  /** As the sign-up leaves them: a password, not approved yet. */
  async function selfRegistered(label: string) {
    const id = await create(label)
    await db.update(instructors).set({ approvedAt: null, passwordHash: "x" }).where(eq(instructors.id, id))
    return id
  }
  const parse = (sp: Record<string, string>) =>
    parseTableParams(sp, { sort: instructorTable.sort, defaultSort: "name", filters: instructorTable.filters })

  it("instructors added by an admin are approved from the start", async () => {
    const id = await create("approved-on-create")
    expect((await row(id)).approvedAt).toBeInstanceOf(Date)
    expect((await getInstructor(id))?.approved).toBe(true)
  })

  it("a waiting instructor is listed as pending, counted, and not offered for workshops", async () => {
    const id = await selfRegistered("pending")
    expect(await countPendingInstructors()).toBeGreaterThan(0)
    const pending = await listInstructors(parse({ q: run, status: "pending" }), "en")
    expect(pending.rows.map((r) => r.id)).toContain(id)
    expect(pending.rows.every((r) => r.active && !r.approved)).toBe(true)
    const active = await listInstructors(parse({ q: run, status: "active" }), "en")
    expect(active.rows.map((r) => r.id)).not.toContain(id)
    expect((await getInstructorOptions()).map((o) => o.id)).not.toContain(id)
  })

  it("approving makes them available, emails them in their language, audits once", async () => {
    const id = await selfRegistered("approve")
    await db.update(instructors).set({ locale: "fa" }).where(eq(instructors.id, id))
    sendEmail.mockClear()
    expect(await approveInstructor({ id })).toEqual({ ok: true, data: { id, emailed: true } })
    expect((await row(id)).approvedAt).toBeInstanceOf(Date)
    expect((await getInstructorOptions()).map((o) => o.id)).toContain(id)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      template: "instructor_approved",
      locale: "fa",
      props: { panelUrl: "/fa/instructor" },
    })
    // Approving again changes nothing and sends nothing.
    expect(await approveInstructor({ id })).toEqual({ ok: true, data: { id, emailed: false } })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect((await audits(id)).filter((a) => a.action === "instructor.approve")).toHaveLength(1)
  })

  it("is refused for an inactive instructor and a missing one", async () => {
    const id = await selfRegistered("approve-inactive")
    await setInstructorActive({ id, active: false })
    expect(await approveInstructor({ id })).toMatchObject({
      ok: false,
      error: "This instructor is inactive. Activate them first, then approve.",
    })
    expect(await approveInstructor({ id: randomUUID() })).toMatchObject({ ok: false })
  })
})
