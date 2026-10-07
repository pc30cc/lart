import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { parseTableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { auditLog, categories, contracts, courses, instructors, media, members, registrations, templates } from "@/db/schema"
import { sealSignedText } from "@/features/contracts/signed-text"
import { prepareClosing } from "@/features/money/closing"
import { postAdvance, postRegistrationPayment, today } from "@/features/money/ledger"
import { sendDayBeforeReminders } from "@/features/registrations/admin/reminders"
import { cancelWorkshop, confirmWorkshop, createWorkshop, raiseFinalParticipants, saveGallery, updateWorkshop } from "./actions"
import { getWorkshop, listConsents, listGallery, listRegistrations, listWorkshops } from "./queries"
import { workshopTable } from "./schema"
import {
  addRegistration,
  createAdmin,
  createCategory,
  createInstructor,
  createMember,
  createTermsTemplate,
  defaultContractTemplate,
  runId,
  text,
  workshopInput,
} from "./test-fixtures"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    workshops: (await import("../../../messages/en/workshops.json")).default,
    contracts: (await import("../../../messages/en/contracts.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
const background = vi.hoisted(() => [] as Promise<unknown>[])
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void background.push(Promise.resolve().then(fn)) }))
const sendEmail = vi.hoisted(() => vi.fn<(input: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true })))
vi.mock("@/lib/email", () => ({ sendEmail }))
const removed = vi.hoisted(() => [] as string[])
vi.mock("@/lib/storage", () => ({
  getStorage: async () => ({
    publicUrl: (path: string) => `https://cdn.test/${path}`,
    remove: async (path: string) => void removed.push(path),
  }),
}))
const session = vi.hoisted(() => ({ sessionId: "test", admin: { id: "", email: "", name: "Workshop Tester", shareBp: 0 } }))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const run = runId()
const HOUR = 3_600_000
const DAY = 24 * HOUR
const made = { courses: [] as string[], members: [] as string[], instructors: [] as string[], terms: [] as string[] }
let refs: { categoryId: string; instructorId: string }
let instructorEmail: string
let templateId: string
let termsId: string

beforeAll(async () => {
  const admin = await createAdmin(run)
  Object.assign(session.admin, { id: admin.id, email: admin.email })
  const [category, instructor, terms] = await Promise.all([createCategory(run), createInstructor(run), createTermsTemplate(run)])
  refs = { categoryId: category.id, instructorId: instructor.id }
  instructorEmail = instructor.email
  made.instructors.push(instructor.id)
  termsId = terms.id
  made.terms.push(terms.id)
  templateId = await defaultContractTemplate()
})

afterAll(async () => {
  await Promise.all(background)
  if (made.courses.length) {
    await db.delete(media).where(inArray(media.courseId, made.courses))
    await db.delete(registrations).where(inArray(registrations.courseId, made.courses))
    await db.delete(contracts).where(inArray(contracts.courseId, made.courses))
    await db.delete(courses).where(inArray(courses.id, made.courses))
  }
  if (made.members.length) await db.delete(members).where(inArray(members.id, made.members))
  await db.delete(templates).where(inArray(templates.id, made.terms))
  await db.delete(instructors).where(inArray(instructors.id, made.instructors))
  await db.delete(categories).where(eq(categories.id, refs.categoryId))
})

beforeEach(() => {
  sendEmail.mockClear()
  removed.length = 0
})

async function create(overrides: Parameters<typeof workshopInput>[2] = {}) {
  const result = await createWorkshop(workshopInput(run, refs, overrides))
  if (!result.ok) throw new Error(`${result.error} ${JSON.stringify(result.fieldErrors)}`)
  made.courses.push(result.data.id)
  return result.data
}

const contractsOf = (courseId: string) =>
  db.select().from(contracts).where(eq(contracts.courseId, courseId)).orderBy(asc(contracts.version))
const courseRow = async (id: string) => (await db.select().from(courses).where(eq(courses.id, id)))[0]
const lastAudit = async (entityId: string) =>
  (await db.select().from(auditLog).where(eq(auditLog.entityId, entityId)).orderBy(desc(auditLog.at)).limit(1))[0]

/** Edit with the saved values plus changes (as the edit form sends them). */
async function edit(id: string, changes: Parameters<typeof workshopInput>[2]) {
  const w = (await getWorkshop(id))!
  const advance = w.contract?.advanceAmount ?? 0
  return updateWorkshop({
    ...workshopInput(run, { categoryId: w.categoryId, instructorId: w.instructorId }),
    id,
    title: { fa: w.title.fa ?? "", tr: w.title.tr ?? "", en: w.title.en ?? "" },
    slug: w.slug,
    startsAt: w.startsAt.toISOString(),
    endsAt: w.endsAt.toISOString(),
    registrationDeadline: w.registrationDeadline.toISOString(),
    decisionAt: w.decisionAt.toISOString(),
    venue: text(w.venue),
    minCapacity: w.minCapacity,
    maxCapacity: w.maxCapacity,
    price: w.price,
    coverPath: w.coverPath,
    samples: w.samples,
    intro: text(w.intro ?? {}),
    feeType: w.contract?.feeType ?? "per_participant",
    feeAmount: w.contract?.feeAmount ?? 0,
    hasAdvance: advance > 0,
    advanceAmount: advance || null,
    ...changes,
  })
}

/** What signing does to the database (signContract itself is tested in contracts/sign.test.ts). */
async function markSigned(courseId: string) {
  await db
    .update(contracts)
    .set({ status: "signed", signedAt: new Date(), ...sealSignedText("x") })
    .where(and(eq(contracts.courseId, courseId), eq(contracts.status, "sent")))
  await db.update(courses).set({ status: "published", publishedAt: new Date() }).where(eq(courses.id, courseId))
}

async function newMember() {
  const member = await createMember(run)
  made.members.push(member.id)
  return member
}

/**
 * Ledger rows can't be deleted: a workshop with money in the ledger stays in
 * the test database, with a category, instructor and terms of its own (never
 * cleaned up, unlike `refs`).
 */
let keptWorld: Promise<{ categoryId: string; instructorId: string; termsId: string }> | undefined
const kept = () =>
  (keptWorld ??= Promise.all([createCategory(run), createInstructor(run), createTermsTemplate(run)]).then(
    ([category, instructor, terms]) => ({ categoryId: category.id, instructorId: instructor.id, termsId: terms.id }),
  ))

async function createKept(overrides: Parameters<typeof workshopInput>[2] = {}) {
  const result = await createWorkshop(workshopInput(run, await kept(), overrides))
  if (!result.ok) throw new Error(`${result.error} ${JSON.stringify(result.fieldErrors)}`)
  return result.data.id
}

/** An advance paid to the workshop's instructor, or returned by them (Money → advance). */
const moveAdvance = (courseId: string, amount: number, direction: "paid" | "returned") =>
  db.transaction((tx) =>
    postAdvance(tx, { courseId, amount, direction, source: "wallet", occurredOn: today(), description: "", createdBy: session.admin.id }),
  )

describe("createWorkshop", () => {
  it("creates the workshop and contract v1 in one go, audits it and emails the instructor", async () => {
    const sample = { path: `workshops/new/samples/sample${run}.webp`, width: 1600, height: 1200 }
    const { id, emailSent, contractVersion } = await create({ samples: [sample], coverPath: `workshops/new/cover-${run}.webp` })
    expect(emailSent).toBe(true)
    expect(contractVersion).toBe(1)

    const course = await courseRow(id)
    expect(course).toMatchObject({ status: "awaiting_signature", createdBy: session.admin.id, bring: null, price: 150_000 })
    const [contract] = await contractsOf(id)
    expect(contract).toMatchObject({
      version: 1,
      status: "sent",
      templateId,
      instructorId: refs.instructorId,
      feeType: "per_participant",
      feeAmount: 50_000,
      advanceAmount: 100_000,
    })
    const rows = await db.select().from(media).where(eq(media.courseId, id))
    expect(rows).toMatchObject([{ kind: "sample", path: sample.path, width: 1600, height: 1200, sort: 0 }])
    expect(await lastAudit(id)).toMatchObject({ action: "workshop.create", adminId: session.admin.id })

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: instructorEmail,
      template: "contract_ready",
      locale: "tr",
      props: { instructorName: "Zeynep", signUrl: `/tr/instructor/contracts/${contract.id}` },
    })
  })

  it("emails the contract in the instructor's own language, with the sign link in that language", async () => {
    const english = await createInstructor(run)
    made.instructors.push(english.id)
    await db.update(instructors).set({ locale: "en" }).where(eq(instructors.id, english.id))
    const result = await createWorkshop(workshopInput(run, { ...refs, instructorId: english.id }))
    if (!result.ok) throw new Error(result.error)
    made.courses.push(result.data.id)
    const [contract] = await contractsOf(result.data.id)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: english.email,
      template: "contract_ready",
      locale: "en",
      props: { workshopTitle: expect.any(String), signUrl: `/en/instructor/contracts/${contract.id}` },
    })
  })

  it("still saves when the email can't be sent, and says so", async () => {
    sendEmail.mockResolvedValueOnce({ ok: false })
    const { id, emailSent } = await create()
    expect(emailSent).toBe(false)
    expect((await contractsOf(id))[0].status).toBe("sent")
  })

  it("refuses a taken page address on the slug field", async () => {
    const { id } = await create()
    const result = await createWorkshop(workshopInput(run, refs, { slug: (await courseRow(id)).slug }))
    expect(result).toMatchObject({ ok: false, fieldErrors: { slug: expect.stringContaining("page address") } })
  })

  it("refuses an inactive instructor", async () => {
    const inactive = await createInstructor(run, { active: false })
    made.instructors.push(inactive.id)
    const result = await createWorkshop(workshopInput(run, { ...refs, instructorId: inactive.id }))
    expect(result).toMatchObject({ ok: false, fieldErrors: { instructorId: "This instructor isn’t active. Please choose another one." } })
  })

  it("refuses a contract template as terms template, and invalid input", async () => {
    const wrong = await createWorkshop(workshopInput(run, refs, { termsTemplateId: templateId }))
    expect(wrong).toMatchObject({ ok: false, fieldErrors: { termsTemplateId: expect.any(String) } })
    const invalid = await createWorkshop(workshopInput(run, refs, { maxCapacity: 2, minCapacity: 3 }))
    expect(invalid).toMatchObject({ ok: false, fieldErrors: { maxCapacity: "The maximum can’t be less than the minimum." } })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe("updateWorkshop", () => {
  it("edits free fields without touching the contract", async () => {
    const { id } = await create()
    sendEmail.mockClear()
    const result = await edit(id, { intro: text({ tr: "Yeni tanıtım", en: "New intro" }) })
    expect(result).toEqual({ ok: true, data: { id, contractVersion: null, emailSent: null } })
    expect(await contractsOf(id)).toHaveLength(1)
    expect((await courseRow(id)).intro).toEqual({ tr: "Yeni tanıtım", en: "New intro" })
    expect((await lastAudit(id)).data).toMatchObject({ intro: { to: { tr: "Yeni tanıtım", en: "New intro" } } })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("re-issues an unsigned contract when a contract field changes", async () => {
    const { id } = await create()
    sendEmail.mockClear()
    const result = await edit(id, { venue: text({ tr: "Kadıköy Atölye", fa: "آتلیهٔ کادیکوی" }) })
    expect(result).toMatchObject({ ok: true, data: { contractVersion: 2, emailSent: true } })
    const [v1, v2] = await contractsOf(id)
    expect(v1).toMatchObject({ status: "void", version: 1 })
    expect(v1.voidedAt).toBeInstanceOf(Date)
    expect(v2).toMatchObject({ status: "sent", version: 2, templateId })
    expect((await courseRow(id)).venue).toEqual({ tr: "Kadıköy Atölye", fa: "آتلیهٔ کادیکوی" })
    expect((await lastAudit(id)).data).toMatchObject({
      venue: { from: { tr: "Moda Sanat Evi", en: "Moda Art House" }, to: { tr: "Kadıköy Atölye", fa: "آتلیهٔ کادیکوی" } },
      contract: { voidedVersion: 1, newVersion: 2 },
    })
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ template: "contract_ready", props: { signUrl: `/tr/instructor/contracts/${v2.id}` } })
  })

  it("re-issues when a filled-in venue text changes, not when a missing translation is filled in", async () => {
    const { id } = await create()
    const same = await edit(id, { venue: text({ tr: " Moda Sanat Evi ", en: "Moda Art House" }) })
    expect(same).toMatchObject({ ok: true, data: { contractVersion: null } })
    // Persian was empty (it showed the Turkish text): filling it in updates the workshop, not the contract.
    const persian = await edit(id, { venue: text({ tr: "Moda Sanat Evi", en: "Moda Art House", fa: "خانهٔ هنر مودا" }) })
    expect(persian).toEqual({ ok: true, data: { id, contractVersion: null, emailSent: null } })
    expect((await courseRow(id)).venue).toEqual({ tr: "Moda Sanat Evi", en: "Moda Art House", fa: "خانهٔ هنر مودا" })
    expect(await contractsOf(id)).toHaveLength(1)
    expect((await lastAudit(id)).data).toEqual({
      venue: { from: { tr: "Moda Sanat Evi", en: "Moda Art House" }, to: { tr: "Moda Sanat Evi", en: "Moda Art House", fa: "خانهٔ هنر مودا" } },
    })
    // A filled-in translation that changes (English only) does re-issue, like the title.
    const english = await edit(id, { venue: text({ tr: "Moda Sanat Evi", en: "Moda Art House, Studio 2", fa: "خانهٔ هنر مودا" }) })
    expect(english).toMatchObject({ ok: true, data: { contractVersion: 2 } })
    // So does removing one.
    const removed = await edit(id, { venue: text({ tr: "Moda Sanat Evi", en: "Moda Art House, Studio 2" }) })
    expect(removed).toMatchObject({ ok: true, data: { contractVersion: 3 } })
  })

  it("keeps a signed contract when a missing venue translation is filled in", async () => {
    const { id } = await create()
    await markSigned(id)
    sendEmail.mockClear()
    const result = await edit(id, { venue: text({ tr: "Moda Sanat Evi", en: "Moda Art House", fa: "خانهٔ هنر مودا" }) })
    expect(result).toEqual({ ok: true, data: { id, contractVersion: null, emailSent: null } })
    expect(await courseRow(id)).toMatchObject({ status: "published", venue: { fa: "خانهٔ هنر مودا" } })
    expect((await contractsOf(id)).map((c) => c.status)).toEqual(["signed"])
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("voids a signed contract on a fee change: the workshop waits for the signature again", async () => {
    const { id } = await create()
    await markSigned(id)
    const result = await edit(id, { feeType: "fixed", feeAmount: 400_000, advanceAmount: 50_000 })
    expect(result).toMatchObject({ ok: true, data: { contractVersion: 2 } })
    const [v1, v2] = await contractsOf(id)
    expect(v1.status).toBe("void")
    expect(v2).toMatchObject({ status: "sent", feeType: "fixed", feeAmount: 400_000, advanceAmount: 50_000 })
    expect(await courseRow(id)).toMatchObject({ status: "awaiting_signature", finalParticipants: null })
    expect((await lastAudit(id)).data).toMatchObject({ status: { from: "published", to: "awaiting_signature" } })
  })

  it("re-issues the contract of a confirmed workshop before it starts, keeping the go decision and final number", async () => {
    const { id } = await create()
    await markSigned(id)
    await db.update(courses).set({ status: "confirmed", finalParticipants: 3 }).where(eq(courses.id, id))
    const result = await edit(id, { venue: text({ tr: "Studio 2" }) })
    expect(result).toMatchObject({ ok: true, data: { contractVersion: 2 } })
    expect((await contractsOf(id)).map((c) => c.status)).toEqual(["void", "sent"])
    expect(await courseRow(id)).toMatchObject({ status: "awaiting_signature", finalParticipants: 3, venue: { tr: "Studio 2" } })
    expect((await lastAudit(id)).data).toMatchObject({ status: { from: "confirmed", to: "awaiting_signature" } })
  })

  it("locks the contract of a confirmed workshop once it has started, but texts stay editable", async () => {
    const { id } = await create()
    await markSigned(id)
    const start = new Date(Date.now() - 2 * 86_400_000)
    await db
      .update(courses)
      .set({
        status: "confirmed",
        finalParticipants: 3,
        startsAt: start,
        endsAt: new Date(start.getTime() + 3 * 3_600_000),
        registrationDeadline: new Date(start.getTime() - 86_400_000),
        decisionAt: new Date(start.getTime() - 86_400_000),
      })
      .where(eq(courses.id, id))
    const venue = (await courseRow(id)).venue

    expect(await edit(id, { venue: text({ tr: "Studio 2" }) })).toEqual({
      ok: false,
      error: "This workshop is cancelled or closed, or it has started after it was confirmed, so its date, place, capacity, instructor and fee can’t change.",
    })
    expect(await edit(id, { feeAmount: 60_000 })).toMatchObject({ ok: false })
    expect(await courseRow(id)).toMatchObject({ status: "confirmed", finalParticipants: 3, venue })
    expect(await contractsOf(id)).toHaveLength(1)
    expect(await edit(id, { intro: text({ tr: "Hikâye" }) })).toMatchObject({ ok: true, data: { contractVersion: null } })
    expect(await courseRow(id)).toMatchObject({ status: "confirmed", finalParticipants: 3 })
    // A missing translation of the venue can still be filled in; it does not change the contract.
    const translated = await edit(id, { venue: text({ ...venue, fa: "خانهٔ هنر مودا" }) })
    expect(translated).toMatchObject({ ok: true, data: { contractVersion: null } })
    expect(await courseRow(id)).toMatchObject({ status: "confirmed", venue: { ...venue, fa: "خانهٔ هنر مودا" } })
    expect(await contractsOf(id)).toHaveLength(1)
  })

  it("re-issues on a new instructor, a new title and new times", async () => {
    const { id } = await create()
    const other = await createInstructor(run)
    made.instructors.push(other.id)
    await edit(id, { instructorId: other.id })
    await edit(id, { title: { fa: "شمع", tr: "Yeni ad", en: "New name" } })
    const w = (await getWorkshop(id))!
    await edit(id, { endsAt: new Date(w.endsAt.getTime() + 3_600_000).toISOString() })
    const all = await contractsOf(id)
    expect(all.map((c) => c.status)).toEqual(["void", "void", "void", "sent"])
    expect(all[1].instructorId).toBe(other.id)
  })

  it("resets the decision reminder when the decision time moves", async () => {
    const { id } = await create()
    await db.update(courses).set({ decisionNotifiedAt: new Date() }).where(eq(courses.id, id))
    const w = (await getWorkshop(id))!
    await edit(id, { decisionAt: new Date(w.decisionAt.getTime() - 3_600_000).toISOString() })
    expect((await courseRow(id)).decisionNotifiedAt).toBeNull()
  })

  it("reminds everyone again before the new date when the workshop moves", async () => {
    const { id } = await create()
    await markSigned(id)
    const member = await newMember()
    const open = await addRegistration(id, member.id, termsId, { status: "pending" })
    const gone = await addRegistration(id, member.id, termsId, { status: "cancelled" })
    const w = (await getWorkshop(id))!
    type Sent = { to: string; template: string; props: { date: string } }
    const reminders = () =>
      sendEmail.mock.calls.map((c) => c[0] as Sent).filter((m) => m.template === "workshop_reminder" && m.to === member.email)
    const remindedAt = async (regId: string) =>
      (await db.select({ at: registrations.reminderSentAt }).from(registrations).where(eq(registrations.id, regId)))[0].at

    await sendDayBeforeReminders(new Date(w.startsAt.getTime() - 12 * HOUR))
    expect(reminders()).toHaveLength(1)
    await db.update(registrations).set({ reminderSentAt: new Date() }).where(eq(registrations.id, gone.id))

    // Texts don't touch the reminder; a new start time does (only for open registrations).
    expect(await edit(id, { intro: text({ tr: "Yeni" }) })).toMatchObject({ ok: true })
    expect(await remindedAt(open.id)).not.toBeNull()
    const later = (d: Date) => new Date(d.getTime() + 7 * DAY).toISOString()
    const moved = await edit(id, {
      startsAt: later(w.startsAt),
      endsAt: later(w.endsAt),
      registrationDeadline: later(w.registrationDeadline),
      decisionAt: later(w.decisionAt),
    })
    expect(moved).toMatchObject({ ok: true, data: { contractVersion: 2 } })
    expect(await remindedAt(open.id)).toBeNull()
    expect(await remindedAt(gone.id)).not.toBeNull()
    expect((await lastAudit(id)).data).toMatchObject({ remindersReset: 1 })

    await sendDayBeforeReminders(new Date(w.startsAt.getTime() + 7 * DAY - 12 * HOUR))
    const [first, second] = reminders()
    expect(reminders()).toHaveLength(2)
    expect(second.props.date).not.toBe(first.props.date)
  })

  it("won't give the workshop to another instructor while an advance is held, until it is returned", async () => {
    const id = await createKept()
    await markSigned(id)
    const { instructorId: first } = await kept()
    const other = await createInstructor(run) // kept: its contract stays with the workshop
    await moveAdvance(id, 100_000, "paid")
    sendEmail.mockClear()

    const held =
      "The current instructor still holds an advance of ₺1,000. Record it as returned on the Finances page before choosing another instructor."
    expect(await edit(id, { instructorId: other.id })).toEqual({ ok: false, error: held, fieldErrors: { instructorId: held } })
    expect(await courseRow(id)).toMatchObject({ instructorId: first, status: "published" })
    expect((await contractsOf(id)).map((c) => [c.status, c.instructorId])).toEqual([["signed", first]])
    expect(sendEmail).not.toHaveBeenCalled()

    // Part of it returned: the rest is still held. Other changes don't depend on it.
    await moveAdvance(id, 40_000, "returned")
    expect(await edit(id, { instructorId: other.id })).toMatchObject({
      ok: false,
      fieldErrors: { instructorId: expect.stringContaining("₺600") },
    })
    expect(await edit(id, { intro: text({ tr: "Yeni" }) })).toMatchObject({ ok: true, data: { contractVersion: null } })

    await moveAdvance(id, 60_000, "returned")
    expect(await edit(id, { instructorId: other.id })).toMatchObject({ ok: true, data: { contractVersion: 2, emailSent: true } })
    expect((await contractsOf(id)).map((c) => [c.status, c.instructorId])).toEqual([
      ["void", first],
      ["sent", other.id],
    ])
    expect(sendEmail.mock.calls.at(-1)?.[0]).toMatchObject({ to: other.email, template: "contract_ready" })
  })

  it("locks the price and keeps the capacity above the registrations", async () => {
    const { id } = await create({ minCapacity: 1 })
    const member = await newMember()
    await addRegistration(id, member.id, termsId, { status: "confirmed" })
    await addRegistration(id, member.id, termsId, { status: "pending" })
    await addRegistration(id, member.id, termsId, { status: "cancelled" })

    const price = await edit(id, { price: 200_000 })
    expect(price).toMatchObject({ ok: false, fieldErrors: { price: "People have already registered at this price, so it can’t be changed." } })
    const capacity = await edit(id, { maxCapacity: 1, hasAdvance: false, advanceAmount: null })
    expect(capacity).toMatchObject({ ok: false, fieldErrors: { maxCapacity: expect.stringContaining("2 people") } })
    expect((await courseRow(id)).price).toBe(150_000)
  })

  it("removes a replaced cover and dropped samples from storage after saving", async () => {
    // Files stored before the named folders (courses/<yyyy-mm>/…) are still accepted when the workshop is saved again.
    const cover = `courses/2026-10/old${run}.webp`
    const a = { path: `courses/2026-10/a${run}.webp` }
    const b = { path: `workshops/w-${run}/samples/b${run}.webp` }
    const { id } = await create({ coverPath: cover, samples: [a, b] })
    await edit(id, { coverPath: `workshops/w-${run}/cover-new${run}.webp`, samples: [b] })
    expect(removed).toEqual(expect.arrayContaining([cover, a.path]))
    const rows = await db.select().from(media).where(eq(media.courseId, id))
    expect(rows).toMatchObject([{ path: b.path, sort: 0 }])
  })

  it("keeps contract fields of a cancelled workshop, but texts stay editable", async () => {
    const { id } = await create()
    expect(await cancelWorkshop({ id })).toMatchObject({ ok: true })
    expect(await edit(id, { venue: text({ tr: "Elsewhere" }) })).toMatchObject({ ok: false, error: expect.stringContaining("cancelled or closed") })
    expect((await courseRow(id)).venue).toEqual({ tr: "Moda Sanat Evi", en: "Moda Art House" })
    expect(await edit(id, { intro: text({ tr: "Hikâye" }) })).toMatchObject({ ok: true })
  })

  it("finds a workshop in the list by its venue, in any language", async () => {
    const venue = { fa: `خانهٔ هنر ${run}`, tr: `Sanat Evi ${run}`, en: `Art House ${run}` }
    const { id } = await create({ venue: text(venue) })
    for (const q of Object.values(venue)) {
      const params = parseTableParams({ q, view: "all" }, { ...workshopTable, defaultSort: "startsAt" })
      const { rows } = await listWorkshops(params, "en")
      expect(rows.map((r) => r.id)).toEqual([id])
    }
  })

  it("counts everyone registered in the list's fill column, paid or not yet", async () => {
    const { id } = await create()
    const person = await newMember()
    for (const status of ["confirmed", "pending", "pending", "cancelled"] as const) await addRegistration(id, person.id, termsId, { status })
    const params = parseTableParams({ q: (await courseRow(id)).slug, view: "all" }, { ...workshopTable, defaultSort: "startsAt" })
    const { rows } = await listWorkshops(params, "en")
    expect(rows.map((r) => [r.id, r.registered])).toEqual([[id, 3]])
    expect((await getWorkshop(id))!.registered).toEqual({ pending: 2, confirmed: 1, cancelled: 1 })
  })

  it("says so when the workshop is gone", async () => {
    const result = await updateWorkshop({ ...workshopInput(run, refs), id: crypto.randomUUID() })
    expect(result).toEqual({ ok: false, error: "This workshop no longer exists." })
  })
})

describe("online payment link", () => {
  it("is saved with the workshop, outside the contract, and can be removed", async () => {
    const { id } = await create({ paymentUrl: " https://iyzi.link/AB12cd " })
    expect(await courseRow(id)).toMatchObject({ paymentUrl: "https://iyzi.link/AB12cd" })
    expect(await lastAudit(id)).toMatchObject({ data: { paymentUrl: "https://iyzi.link/AB12cd" } })

    // Left out (an older form): unchanged. Changed: no new contract version.
    expect(await edit(id, { intro: text({ tr: "Yeni" }) })).toMatchObject({ ok: true })
    expect(await courseRow(id)).toMatchObject({ paymentUrl: "https://iyzi.link/AB12cd" })
    expect(await edit(id, { paymentUrl: "https://www.paytr.com/link/XyZ" })).toMatchObject({ ok: true, data: { contractVersion: null } })
    expect(await lastAudit(id)).toMatchObject({
      data: { paymentUrl: { from: "https://iyzi.link/AB12cd", to: "https://www.paytr.com/link/XyZ" } },
    })
    expect(await edit(id, { paymentUrl: "" })).toMatchObject({ ok: true })
    expect(await courseRow(id)).toMatchObject({ paymentUrl: null })
  })

  it("must be a plain https link", async () => {
    for (const paymentUrl of ["http://iyzi.link/AB12", "javascript:alert(1)", "iyzi.link/AB12", "https://user:pw@iyzi.link/x"]) {
      const result = await createWorkshop(workshopInput(run, refs, { paymentUrl }))
      expect(result).toMatchObject({
        ok: false,
        fieldErrors: { paymentUrl: "Please paste the whole payment link, starting with https://." },
      })
    }
  })
})

describe("go / no-go", () => {
  it("confirms a published workshop and fixes the number of participants: paid and not paid yet count", async () => {
    const { id } = await create()
    expect(await confirmWorkshop({ id })).toMatchObject({ ok: false, error: expect.stringContaining("open for registration") })
    await markSigned(id)
    const member = await newMember()
    await addRegistration(id, member.id, termsId, { status: "confirmed" })
    await addRegistration(id, member.id, termsId, { status: "confirmed" })
    // Many pay in cash at the workshop: registered and not paid yet counts too.
    await addRegistration(id, member.id, termsId, { status: "pending" })
    await addRegistration(id, member.id, termsId, { status: "cancelled" })

    expect(await confirmWorkshop({ id })).toEqual({ ok: true, data: { id, finalParticipants: 3 } })
    expect(await courseRow(id)).toMatchObject({ status: "confirmed", finalParticipants: 3 })
    expect(await lastAudit(id)).toMatchObject({ action: "workshop.confirm", data: { finalParticipants: 3, minimum: 4 } })
    expect(await confirmWorkshop({ id })).toMatchObject({ ok: false, error: expect.stringContaining("open for registration") })
  })

  it("confirms a workshop that took place without a go decision, so it closes with the fee from its contract", async () => {
    const id = await createKept({ hasAdvance: false, advanceAmount: null })
    await markSigned(id)
    const start = new Date(Date.now() - 5 * HOUR)
    await db
      .update(courses)
      .set({
        startsAt: start,
        endsAt: new Date(start.getTime() + 2 * HOUR),
        registrationDeadline: new Date(start.getTime() - DAY),
        decisionAt: new Date(start.getTime() - DAY),
      })
      .where(eq(courses.id, id))
    const { termsId: terms } = await kept()
    const member = await createMember(run) // kept: its payment is in the ledger
    const paid = await addRegistration(id, member.id, terms, { status: "confirmed", amount: 150_000 })
    await addRegistration(id, member.id, terms, { status: "pending", amount: 150_000 })
    await addRegistration(id, member.id, terms, { status: "cancelled" })
    await db.transaction((tx) => postRegistrationPayment(tx, { registrationId: paid.id, occurredOn: today(), createdBy: session.admin.id }))

    expect(await confirmWorkshop({ id })).toEqual({ ok: true, data: { id, finalParticipants: 2 } })
    expect(await courseRow(id)).toMatchObject({ status: "confirmed", finalParticipants: 2 })

    // It ended 3 hours ago: it can be closed, nobody is owed a refund, the fee is per participant (2 × ₺500).
    const closing = (await prepareClosing(db, id))!
    // (The partners' shares depend on the other admins in the test database.) The registration
    // not paid yet must be paid or cancelled before closing (`unpaidRegistrations`).
    expect(closing.issues.filter((i) => i !== "sharesNot100")).toEqual(["unpaidRegistrations"])
    expect(closing.plan.figures).toMatchObject({ revenue: 150_000, instructorFee: 100_000, participants: 2, owedToInstructor: 100_000 })
  })

  it("raises the final number after the go decision, once the instructor agreed: higher, at most the maximum, before the start", async () => {
    const { id } = await create({ minCapacity: 2, maxCapacity: 6 })
    expect(await raiseFinalParticipants({ id, finalParticipants: 4 })).toMatchObject({
      ok: false,
      error: "The final number can only be raised for a confirmed workshop that hasn’t started yet.",
    })
    await markSigned(id)
    const member = await newMember()
    await addRegistration(id, member.id, termsId, { status: "confirmed" })
    await addRegistration(id, member.id, termsId, { status: "pending" })
    expect(await confirmWorkshop({ id })).toMatchObject({ ok: true, data: { finalParticipants: 2 } })

    expect(await raiseFinalParticipants({ id, finalParticipants: 2 })).toMatchObject({
      ok: false,
      fieldErrors: { finalParticipants: "The new number must be higher than the current final number (2)." },
    })
    expect(await raiseFinalParticipants({ id, finalParticipants: 7 })).toMatchObject({
      ok: false,
      fieldErrors: { finalParticipants: "The new number can’t be more than the maximum of 6." },
    })
    expect(await raiseFinalParticipants({ id, finalParticipants: 4 })).toEqual({ ok: true, data: { id, finalParticipants: 4 } })
    expect(await courseRow(id)).toMatchObject({ status: "confirmed", finalParticipants: 4 })
    expect(await lastAudit(id)).toMatchObject({
      action: "workshop.raiseFinal",
      data: { from: 2, to: 4, instructorApproved: true },
    })

    // Once it has started, the number stays.
    await db.update(courses).set({ startsAt: new Date(Date.now() - HOUR) }).where(eq(courses.id, id))
    expect(await raiseFinalParticipants({ id, finalParticipants: 5 })).toMatchObject({ ok: false })
    expect(await courseRow(id)).toMatchObject({ finalParticipants: 4 })
  })

  it("cancels: open registrations are cancelled and refunded, everyone registered is emailed once", async () => {
    const { id } = await create()
    await markSigned(id)
    const [parent, payer, unpaid] = [await newMember(), await newMember(), await newMember()]
    await db.update(members).set({ locale: "en" }).where(eq(members.id, payer.id))
    const r1 = await addRegistration(id, parent.id, termsId, { status: "confirmed", amount: 150_000 })
    const r2 = await addRegistration(id, parent.id, termsId, { status: "confirmed", amount: 120_000 })
    const r3 = await addRegistration(id, payer.id, termsId, { status: "confirmed", amount: 150_000 })
    const r4 = await addRegistration(id, unpaid.id, termsId, { status: "pending", amount: 150_000 })
    sendEmail.mockClear()

    const result = await cancelWorkshop({ id })
    expect(result).toEqual({ ok: true, data: { id, cancelledRegistrations: 4, emailed: 3 } })
    await Promise.all(background)

    const course = await courseRow(id)
    expect(course.status).toBe("cancelled")
    expect(course.cancelledAt).toBeInstanceOf(Date)
    const rows = await db.select().from(registrations).where(eq(registrations.courseId, id))
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(r1.id)).toMatchObject({ status: "cancelled", refundAmount: 150_000 })
    expect(byId.get(r2.id)).toMatchObject({ status: "cancelled", refundAmount: 120_000 })
    expect(byId.get(r3.id)).toMatchObject({ status: "cancelled", refundAmount: 150_000 })
    expect(byId.get(r4.id)).toMatchObject({ status: "cancelled", refundAmount: 0 })
    // The signed contract stays as the record.
    expect((await contractsOf(id))[0].status).toBe("signed")

    type Sent = { to: string; template: string; locale: string; props: { refundAmount?: string; workshopsUrl: string } }
    const cancelled = sendEmail.mock.calls.map((c) => c[0] as Sent)
    expect(cancelled.every((c) => c.template === "workshop_cancelled")).toBe(true)
    // Everyone registered, so nobody comes to the venue for nothing; one email per member.
    expect(cancelled.map((c) => c.to).sort()).toEqual([parent.email, payer.email, unpaid.email].sort())
    expect(cancelled.find((c) => c.to === parent.email)!.props.refundAmount).toBe("₺2.700")
    // The unpaid one owes nothing and gets nothing back: no refund line.
    expect(cancelled.find((c) => c.to === unpaid.email)!.props).not.toHaveProperty("refundAmount")
    // In each member's own language.
    expect(cancelled.find((c) => c.to === payer.email)).toMatchObject({
      locale: "en",
      props: { refundAmount: "₺1,500", workshopsUrl: "/en/workshops" },
    })
    expect(await lastAudit(id)).toMatchObject({ action: "workshop.cancel", data: { registrations: 4, refundTotal: 420_000 } })

    expect(await cancelWorkshop({ id })).toMatchObject({ ok: false, error: "This workshop is already cancelled or closed." })
  })

  it("voids an unsigned contract when the workshop is cancelled", async () => {
    const { id } = await create()
    await cancelWorkshop({ id })
    expect((await contractsOf(id))[0]).toMatchObject({ status: "void" })
  })
})

describe("gallery", () => {
  const photo = (name: string) => ({
    kind: "image" as const,
    path: `workshops/w-${run}/gallery/${name}${run}.webp`,
    width: 2400,
    height: 1600,
  })
  const video = (name: string) => ({ kind: "video" as const, path: `workshops/w-${run}/videos/${name}${run}.mp4` })

  it("is only for closed workshops", async () => {
    const { id } = await create()
    expect(await saveGallery({ id, items: [photo("early")] })).toMatchObject({
      ok: false,
      error: "Photos and videos can be added once the workshop is closed.",
    })
  })

  it("is never for a cancelled workshop, also after its books were closed", async () => {
    const { id } = await create()
    await cancelWorkshop({ id })
    // Closing a cancelled workshop sets the status to closed and keeps cancelled_at.
    await db.update(courses).set({ status: "closed", closedAt: new Date() }).where(eq(courses.id, id))
    expect(await saveGallery({ id, items: [photo("cancelled")] })).toEqual({
      ok: false,
      error: "This workshop was cancelled, so it has no gallery.",
    })
    expect(await listGallery(id)).toEqual([])
  })

  it("adds, re-orders and removes photos and videos, and deletes removed files", async () => {
    const { id } = await create()
    await db.update(courses).set({ status: "closed", closedAt: new Date() }).where(eq(courses.id, id))
    // p2 was stored before the named folders (gallery/<yyyy-mm>/…): still accepted.
    const [p1, p2, v1] = [photo("p1"), { ...photo("p2"), path: `gallery/2026-10/p2${run}.webp` }, video("v1")]

    expect(await saveGallery({ id, items: [p1, v1, p2] })).toEqual({ ok: true, data: { id, count: 3 } })
    expect((await listGallery(id)).map((i) => [i.kind, i.path])).toEqual([
      ["image", p1.path],
      ["video", v1.path],
      ["image", p2.path],
    ])

    await saveGallery({ id, items: [p2, p1] })
    expect((await listGallery(id)).map((i) => i.path)).toEqual([p2.path, p1.path])
    expect(removed).toEqual([v1.path])
    expect(await lastAudit(id)).toMatchObject({ action: "workshop.gallery", data: { added: 0, removed: 1, reordered: 2 } })

    removed.length = 0
    await saveGallery({ id, items: [p1] })
    expect(removed).toEqual([p2.path])
    expect(await lastAudit(id)).toMatchObject({ action: "workshop.gallery", data: { added: 0, removed: 1, reordered: 1 } })
  })

  it("keeps no unwatermarked originals: migration 0007 dropped media.original_path", async () => {
    const { rows } = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'media'`,
    )
    expect(rows.map((r) => r.column_name)).toContain("path")
    expect(rows.map((r) => r.column_name)).not.toContain("original_path")
  })

  it("refuses files that belong to another workshop", async () => {
    const [{ id: a }, { id: b }] = [await create(), await create()]
    await db.update(courses).set({ status: "closed" }).where(inArray(courses.id, [a, b]))
    const shared = photo("shared")
    await saveGallery({ id: a, items: [shared] })
    expect(await saveGallery({ id: b, items: [shared] })).toMatchObject({ ok: false, error: expect.stringContaining("already used") })
  })
})

describe("listConsents", () => {
  it("lists everyone registered and not cancelled, paid or not yet", async () => {
    const { id } = await create()
    const member = await newMember()
    const paid = await addRegistration(id, member.id, termsId, { status: "confirmed", photo: true })
    const unpaid = await addRegistration(id, member.id, termsId, { status: "pending", video: true })
    await addRegistration(id, member.id, termsId, { status: "cancelled", photo: true, video: true })
    const rows = await listConsents(id)
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: paid.id, photoConsent: true, videoConsent: false }),
        expect.objectContaining({ id: unpaid.id, photoConsent: false, videoConsent: true }),
      ]),
    )
  })
})

describe("listRegistrations", () => {
  it("lists participants with the member's contact and consents", async () => {
    const { id } = await create()
    const member = await newMember()
    await addRegistration(id, member.id, termsId, { status: "confirmed", photo: true })
    const [row] = await listRegistrations(id)
    expect(row).toMatchObject({ status: "confirmed", photoConsent: true, videoConsent: false, member: { email: member.email } })
  })
})
