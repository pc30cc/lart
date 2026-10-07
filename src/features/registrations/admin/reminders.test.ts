import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { courses, members, registrations } from "@/db/schema"
import { addRegistration, createAdmin, createCategory, createInstructor, createMember, createTermsTemplate, runId } from "@/features/workshops/test-fixtures"
import { settingDefaults, type SettingValue } from "@/lib/settings"
import { sendDayBeforeReminders } from "./reminders"

type Sent = { to: string; template: string; locale: string; idempotencyKey: string; props: Record<string, unknown> }
const sendEmail = vi.hoisted(() => vi.fn<(input: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true })))
vi.mock("@/lib/email", () => ({ sendEmail }))
// The payment setting is shared by every test file: this one reads its own copy.
const payment = vi.hoisted(() => ({ value: null as unknown }))
vi.mock("@/lib/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/settings")>()
  return {
    ...original,
    getSetting: async (key: string) => (key === "payment" ? payment.value : original.getSetting(key as never)),
  }
})

const run = runId()
const HOUR = 3_600_000
const made = { courses: [] as string[], members: [] as string[] }
let refs: { categoryId: string; instructorId: string; termsId: string; adminId: string }

beforeAll(async () => {
  const [admin, category, instructor, terms] = await Promise.all([
    createAdmin(run, "Reminder Tester"),
    createCategory(run),
    createInstructor(run),
    createTermsTemplate(run),
  ])
  refs = { categoryId: category.id, instructorId: instructor.id, termsId: terms.id, adminId: admin.id }
})

afterAll(async () => {
  await db.delete(registrations).where(inArray(registrations.courseId, made.courses))
  await db.delete(courses).where(inArray(courses.id, made.courses))
  await db.delete(members).where(inArray(members.id, made.members))
})

beforeEach(() => {
  sendEmail.mockReset()
  sendEmail.mockResolvedValue({ ok: true })
  payment.value = { ...settingDefaults.payment, cash: true } satisfies SettingValue<"payment">
})

async function workshop(startsInHours: number, options: { status?: "published" | "confirmed" | "cancelled"; bring?: string } = {}) {
  const start = new Date(Date.now() + startsInHours * HOUR)
  const [row] = await db
    .insert(courses)
    .values({
      slug: `remind-${run}-${randomUUID().slice(0, 8)}`,
      status: options.status ?? "confirmed",
      categoryId: refs.categoryId,
      instructorId: refs.instructorId,
      title: { tr: `Mum ${run}`, en: "Candles", fa: "شمع" },
      venue: { tr: "Moda", en: "Moda studio" },
      bring: options.bring ? { tr: options.bring, en: options.bring } : null,
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * HOUR),
      minCapacity: 1,
      maxCapacity: 10,
      price: 150_000,
      registrationDeadline: new Date(start.getTime() - HOUR),
      decisionAt: new Date(start.getTime() - 2 * HOUR),
      publishedAt: new Date(),
      cancelledAt: options.status === "cancelled" ? new Date() : null,
      createdBy: refs.adminId,
    })
    .returning()
  made.courses.push(row.id)
  return row
}

async function member(locale = "tr") {
  const row = await createMember(run, "Nur")
  await db.update(members).set({ locale }).where(eq(members.id, row.id))
  made.members.push(row.id)
  return row
}

/** Reminders about one workshop (other test files may run the job's queries at the same time). */
const sentFor = (slug: string) =>
  sendEmail.mock.calls.map((c) => c[0] as Sent).filter((m) => String(m.props.workshopUrl).endsWith(`/workshops/${slug}`))
const remindedAt = async (id: string) =>
  (await db.select({ at: registrations.reminderSentAt }).from(registrations).where(eq(registrations.id, id)))[0].at

describe("sendDayBeforeReminders", () => {
  it("reminds each member once for a workshop starting within 24 hours, with what is still to pay and how", async () => {
    const w = await workshop(20, { bring: "An apron" })
    const parent = await member("en")
    const paid = await addRegistration(w.id, parent.id, refs.termsId, { status: "confirmed" })
    const unpaid = await addRegistration(w.id, parent.id, refs.termsId, { status: "pending", amount: 150_000 })
    await db.update(registrations).set({ participantName: "Sara" }).where(eq(registrations.id, unpaid.id))
    const gone = await addRegistration(w.id, parent.id, refs.termsId, { status: "cancelled" })

    const now = new Date()
    await sendDayBeforeReminders(now)
    const sent = sentFor(w.slug)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: parent.email,
      template: "workshop_reminder",
      locale: "en",
      idempotencyKey: `workshop_reminder:${w.id}:${parent.id}`,
      props: { name: "Nur", workshopTitle: "Candles", venue: "Moda studio", workshopUrl: `/en/workshops/${w.slug}` },
    })
    // "What to bring" stays the workshop's own; the unpaid part has its own row and payment blocks.
    expect(sent[0].props).toMatchObject({ bring: "An apron", participantName: "Sara", cash: true })
    expect(sent[0].props.amount).toMatch(/^₺1,500(\.00)?$/)
    expect(sent[0].props).not.toHaveProperty("transfer")
    expect(sent[0].props).not.toHaveProperty("paymentUrl")
    expect(await remindedAt(paid.id)).toEqual(now)
    expect(await remindedAt(unpaid.id)).toEqual(now)
    expect(await remindedAt(gone.id)).toBeNull()

    // Idempotent: the next run leaves them alone.
    sendEmail.mockClear()
    await sendDayBeforeReminders()
    expect(sentFor(w.slug)).toHaveLength(0)
  })

  it("writes in the member's language, says nothing about paying when all is paid, and shows only the ways that are on", async () => {
    const w = await workshop(5)
    await db.update(courses).set({ paymentUrl: "https://iyzi.link/abc" }).where(eq(courses.id, w.id))
    const paidOnly = await member("fa")
    await addRegistration(w.id, paidOnly.id, refs.termsId, { status: "confirmed" })
    const cashOff = await member("tr")
    await addRegistration(w.id, cashOff.id, refs.termsId, { status: "pending" })
    payment.value = { ...settingDefaults.payment, cash: false, online: { enabled: true, note: { tr: "Kartla" } } }

    await sendDayBeforeReminders()
    const sent = sentFor(w.slug)
    const fa = sent.find((m) => m.to === paidOnly.email)
    expect(fa).toMatchObject({ locale: "fa", props: { workshopTitle: "شمع" } })
    for (const key of ["bring", "amount", "cash", "transfer", "paymentUrl"]) expect(fa?.props).not.toHaveProperty(key)
    const tr = sent.find((m) => m.to === cashOff.email)
    expect(tr?.props).toMatchObject({ paymentUrl: "https://iyzi.link/abc", onlineNote: "Kartla" })
    expect(tr?.props.amount).toEqual(expect.stringContaining("1.500"))
    expect(tr?.props).not.toHaveProperty("cash")
  })

  it("leaves workshops further away, already started or cancelled", async () => {
    const later = await workshop(30)
    const started = await workshop(-1)
    const cancelled = await workshop(10, { status: "cancelled" })
    const person = await member()
    const regs = await Promise.all(
      [later, started, cancelled].map((w) => addRegistration(w.id, person.id, refs.termsId, { status: "pending" })),
    )
    await sendDayBeforeReminders()
    for (const w of [later, started, cancelled]) expect(sentFor(w.slug)).toHaveLength(0)
    for (const r of regs) expect(await remindedAt(r.id)).toBeNull()
  })

  it("tries again next time when the email could not be sent", async () => {
    const w = await workshop(12)
    const person = await member()
    const r = await addRegistration(w.id, person.id, refs.termsId, { status: "pending" })
    sendEmail.mockResolvedValue({ ok: false })
    await sendDayBeforeReminders()
    expect(sentFor(w.slug)).toHaveLength(1)
    expect(await remindedAt(r.id)).toBeNull()

    sendEmail.mockResolvedValue({ ok: true })
    await sendDayBeforeReminders()
    expect(await remindedAt(r.id)).toBeInstanceOf(Date)
  })

  it("emails each member once when two runs overlap", async () => {
    const w = await workshop(8)
    const person = await member()
    await addRegistration(w.id, person.id, refs.termsId, { status: "pending" })
    await addRegistration(w.id, person.id, refs.termsId, { status: "confirmed" })
    await Promise.all([sendDayBeforeReminders(), sendDayBeforeReminders()])
    expect(sentFor(w.slug)).toHaveLength(1)
  })
})
