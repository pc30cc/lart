import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, courses, instructors, members, registrations, templates } from "@/db/schema"
import { createAdmin, createCategory, createInstructor, runId } from "@/features/workshops/test-fixtures"
import { sessionCookieName } from "@/lib/auth/cookies"
import { createSession } from "@/lib/auth/session"
import { sha256 } from "@/lib/crypto"
import { sendEmail } from "@/lib/email"
import { deleteSetting, getBrand, setSetting } from "@/lib/settings"
import { cancelRegistrationAction, registerAction } from "./actions"
import { sendRegistrationCancelled, sendRegistrationReceived } from "./notify"
import { getPublicWorkshop, listOpenWorkshops, seatsLeft, seatsTaken, workshopTerms } from "./public"
import { cancelMyRegistration, registerForWorkshop, type RegisterInput } from "./register"
import {
  cancelPreview,
  MAX_ACTIVE_PER_MEMBER,
  paymentWayNames,
  registrationWindow,
  safePaymentUrl,
  sameParticipant,
  seatLimit,
} from "./schema"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    account: (await import("../../../messages/en/account.json")).default,
    registration: (await import("../../../messages/en/registration.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})

/** One request: its cookies and the work scheduled with after(). */
const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), afterTasks: [] as Promise<unknown>[] }))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.9", "x-pathname": "/en/workshops" }),
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name) } : undefined),
    set: (name: string, value: string) => (value ? request.cookies.set(name, value) : request.cookies.delete(name)),
  }),
}))
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => request.afterTasks.push(Promise.resolve().then(task)),
}))
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

const HOUR = 3_600_000
const DAY = 24 * HOUR
const run = runId()
let admin: Awaited<ReturnType<typeof createAdmin>>
let categoryId: string
let instructorId: string
let termsId: string

const TERMS_BODY = { en: "Terms of {brand}.\n\n- Cancel 72 hours before: full refund.", tr: "{brand} koşulları." }

beforeAll(async () => {
  admin = await createAdmin(run, "Mina Partner")
  categoryId = (await createCategory(run)).id
  instructorId = (await createInstructor(run)).id
  const [terms] = await db
    .insert(templates)
    .values({ kind: "terms", name: `Registration terms ${run}`, body: TERMS_BODY })
    .returning()
  termsId = terms.id
  await setSetting("payment", {
    cash: true,
    transfer: {
      enabled: true,
      accountHolder: "Lart Sanat",
      bankName: "Ziraat Bankası",
      iban: "TR330006100519786457841326",
      note: { en: "Thank you!" },
    },
    online: { enabled: true, note: { en: "Card payments only." } },
  })
})

afterAll(async () => {
  await deleteSetting("payment")
})

beforeEach(() => {
  request.cookies.clear()
  request.afterTasks = []
  vi.mocked(sendEmail).mockClear()
})

async function newMember(values: Partial<typeof members.$inferInsert> = {}) {
  const [row] = await db
    .insert(members)
    .values({
      email: `reg-${run}-${randomUUID().slice(0, 8)}@test.local`,
      name: "Ayşe Demir",
      passwordHash: "x",
      locale: "en",
      emailVerifiedAt: new Date(),
      ...values,
    })
    .returning()
  return row
}

/** A published workshop starting in `startsIn` ms (default 10 days), registration open until a day before. */
async function newCourse(values: Partial<typeof courses.$inferInsert> = {}, startsIn = 10 * DAY) {
  const start = Date.now() + startsIn
  const [row] = await db
    .insert(courses)
    .values({
      slug: `reg-${run}-${randomUUID().slice(0, 8)}`,
      status: "published",
      categoryId,
      instructorId,
      title: { tr: "Mum Yapımı", en: "Candle making", fa: "شمع‌سازی" },
      venue: { tr: "Moda Sanat Evi", en: "Moda Art House" },
      startsAt: new Date(start),
      endsAt: new Date(start + 2 * HOUR),
      minCapacity: 1,
      maxCapacity: 10,
      price: 150_000,
      registrationDeadline: new Date(start - Math.min(DAY, startsIn / 2)),
      decisionAt: new Date(start - Math.min(2 * DAY, startsIn / 2)),
      termsTemplateId: termsId,
      paymentUrl: "https://iyzi.link/AKtest",
      publishedAt: new Date(),
      createdBy: admin.id,
      ...values,
    })
    .returning()
  return row
}

/** The text the page shows in English, and its hash. */
async function shownTerms() {
  const text = `Terms of ${await getBrand("en")}.\n\n- Cancel 72 hours before: full refund.`
  return { text, sha256: sha256(text) }
}

async function input(courseId: string, values: Partial<RegisterInput> = {}): Promise<RegisterInput> {
  return {
    courseId,
    locale: "en",
    participantName: "Deniz",
    termsSha256: (await shownTerms()).sha256,
    acceptTerms: true,
    photoConsent: true,
    videoConsent: false,
    ...values,
  }
}

const registrationOf = async (id: string) =>
  (await db.select().from(registrations).where(eq(registrations.id, id)))[0]

/** A registration of `memberId`, marked as paid the way an admin would. */
async function paidRegistration(courseId: string, memberId: string, amount = 150_000) {
  const { id } = await registerForWorkshop(memberId, await input(courseId, { participantName: `P ${randomUUID().slice(0, 6)}` }))
  await db
    .update(registrations)
    .set({ status: "confirmed", paymentMethod: "transfer", paidAt: new Date(), amount })
    .where(eq(registrations.id, id))
  return id
}

const rejectsWith = (promise: Promise<unknown>, key: string) => expect(promise).rejects.toMatchObject({ key })

describe("registerForWorkshop", () => {
  it("stores a pending registration at the workshop's price, with the terms proof and consents", async () => {
    const course = await newCourse()
    const member = await newMember()
    const before = new Date()
    const { id, status } = await registerForWorkshop(member.id, await input(course.id))

    expect(status).toBe("pending")
    const row = await registrationOf(id)
    expect(row).toMatchObject({
      courseId: course.id,
      memberId: member.id,
      participantName: "Deniz",
      status: "pending",
      amount: 150_000,
      termsTemplateId: termsId,
      termsSha256: (await shownTerms()).sha256,
      photoConsent: true,
      videoConsent: false,
      paymentMethod: null,
      paidAt: null,
    })
    expect(row.termsAcceptedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
    expect(await seatsTaken(course.id)).toBe(1)
  })

  it("hashes exactly the text the page shows, with the brand filled in", async () => {
    const terms = await workshopTerms(termsId, "en")
    expect(terms).toEqual({ templateId: termsId, ...(await shownTerms()) })
    expect(terms?.text).not.toContain("{brand}")
    // Turkish has its own text, so its own hash.
    expect((await workshopTerms(termsId, "tr"))?.sha256).not.toBe(terms?.sha256)
  })

  it("refuses when the terms changed after the page was shown", async () => {
    const course = await newCourse()
    const member = await newMember()
    await rejectsWith(
      registerForWorkshop(member.id, await input(course.id, { termsSha256: sha256("older text") })),
      "registration.errors.termsChanged",
    )
    expect(await seatsTaken(course.id)).toBe(0)
  })

  it("confirms a free workshop right away (nothing to pay)", async () => {
    const course = await newCourse({ price: 0 })
    const member = await newMember()
    const { id, status } = await registerForWorkshop(member.id, await input(course.id))
    expect(status).toBe("confirmed")
    expect(await registrationOf(id)).toMatchObject({ status: "confirmed", amount: 0, paidAt: null })
  })

  it("gives the last seat to exactly one of several people registering at the same moment", async () => {
    const course = await newCourse({ maxCapacity: 1 })
    const people = await Promise.all([newMember(), newMember(), newMember(), newMember()])
    const tries = await Promise.allSettled(
      people.map(async (m) => registerForWorkshop(m.id, await input(course.id))),
    )
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1)
    for (const t of tries.filter((t) => t.status === "rejected")) {
      expect((t as PromiseRejectedResult).reason).toMatchObject({ key: "registration.errors.full" })
    }
    expect(await seatsTaken(course.id)).toBe(1)
  })

  it("counts registered and paid places as taken, cancelled ones as free", async () => {
    const course = await newCourse({ maxCapacity: 2 })
    const member = await newMember()
    const first = await paidRegistration(course.id, member.id)
    await registerForWorkshop(member.id, await input(course.id, { participantName: "Second" }))
    expect(await seatsTaken(course.id)).toBe(2)
    await rejectsWith(registerForWorkshop(member.id, await input(course.id, { participantName: "Third" })), "registration.errors.full")

    await cancelMyRegistration(member.id, first)
    expect(await seatsTaken(course.id)).toBe(1)
    expect(seatsLeft(course.maxCapacity, await seatsTaken(course.id))).toBe(1)
    await registerForWorkshop(member.id, await input(course.id, { participantName: "Third" }))
  })

  it("is closed after the registration deadline, and once the workshop has started", async () => {
    const member = await newMember()
    const pastDeadline = await newCourse({ registrationDeadline: new Date(Date.now() - HOUR) })
    await rejectsWith(registerForWorkshop(member.id, await input(pastDeadline.id)), "registration.errors.deadline")

    const started = await newCourse(
      { startsAt: new Date(Date.now() - HOUR), registrationDeadline: new Date(Date.now() - 2 * HOUR) },
      HOUR,
    )
    await rejectsWith(registerForWorkshop(member.id, await input(started.id)), "registration.errors.started")
  })

  it("only takes registrations for published or confirmed workshops", async () => {
    const member = await newMember()
    const confirmed = await newCourse({ status: "confirmed", finalParticipants: 4 })
    await registerForWorkshop(member.id, await input(confirmed.id))

    const paused = await newCourse({ status: "awaiting_signature" })
    await rejectsWith(registerForWorkshop(member.id, await input(paused.id)), "registration.errors.notOpen")

    const cancelled = await newCourse({ status: "cancelled", cancelledAt: new Date() })
    await rejectsWith(registerForWorkshop(member.id, await input(cancelled.id)), "registration.errors.cancelled")

    const neverPublished = await newCourse({ status: "awaiting_signature", publishedAt: null })
    await rejectsWith(registerForWorkshop(member.id, await input(neverPublished.id)), "registration.errors.notFound")

    await rejectsWith(registerForWorkshop(member.id, await input(randomUUID())), "registration.errors.notFound")
  })

  it("after the go decision takes no one beyond the final number; a place given up can be taken again", async () => {
    const course = await newCourse({ maxCapacity: 10 })
    const member = await newMember()
    const first = await paidRegistration(course.id, member.id)
    await registerForWorkshop(member.id, await input(course.id, { participantName: "Second" }))
    // The go decision with 2 registered: what confirmWorkshop stores (the instructor is paid for 2).
    await db.update(courses).set({ status: "confirmed", finalParticipants: 2 }).where(eq(courses.id, course.id))

    const other = await newMember()
    await rejectsWith(registerForWorkshop(other.id, await input(course.id)), "registration.errors.full")
    expect(await seatsTaken(course.id)).toBe(2)
    expect(await getPublicWorkshop(course.slug, "en")).toMatchObject({ seatsLeft: 0, window: "full" })

    // Someone cancels after the decision: their place can be taken again, still 2 in all.
    await cancelMyRegistration(member.id, first)
    expect((await listOpenWorkshops("en")).find((w) => w.id === course.id)).toMatchObject({ seatsLeft: 1, window: "open" })
    await registerForWorkshop(other.id, await input(course.id))
    expect(await seatsTaken(course.id)).toBe(2)
    await rejectsWith(registerForWorkshop((await newMember()).id, await input(course.id)), "registration.errors.full")

    // The instructor agreed to one more (contract 5.2) and an admin raised the number.
    await db.update(courses).set({ finalParticipants: 3 }).where(eq(courses.id, course.id))
    await registerForWorkshop((await newMember()).id, await input(course.id))
    expect(await seatsTaken(course.id)).toBe(3)
  })

  it("lets a member register several people, but the same participant only once", async () => {
    const course = await newCourse()
    const member = await newMember()
    const deniz = await registerForWorkshop(member.id, await input(course.id, { participantName: "Deniz Yılmaz" }))
    await registerForWorkshop(member.id, await input(course.id, { participantName: "Elif Yılmaz" }))

    await expect(
      registerForWorkshop(member.id, await input(course.id, { participantName: "  deniz   YILMAZ " })),
    ).rejects.toMatchObject({ key: "registration.errors.duplicate", field: "participantName" })

    // Another member may register someone with the same name.
    await registerForWorkshop((await newMember()).id, await input(course.id, { participantName: "Deniz Yılmaz" }))

    // Once cancelled, the same participant can register again.
    await cancelMyRegistration(member.id, deniz.id)
    await registerForWorkshop(member.id, await input(course.id, { participantName: "Deniz Yılmaz" }))
  })

  it(`holds at most ${MAX_ACTIVE_PER_MEMBER} places per member in one workshop`, async () => {
    const course = await newCourse({ maxCapacity: 20 })
    const member = await newMember()
    for (let i = 0; i < MAX_ACTIVE_PER_MEMBER; i++) {
      await registerForWorkshop(member.id, await input(course.id, { participantName: `Child ${i}` }))
    }
    await rejectsWith(
      registerForWorkshop(member.id, await input(course.id, { participantName: "One more" })),
      "registration.errors.tooMany",
    )
  })
})

describe("cancelMyRegistration", () => {
  it("simply cancels an unpaid registration: no refund", async () => {
    const course = await newCourse()
    const member = await newMember()
    const { id } = await registerForWorkshop(member.id, await input(course.id))
    const result = await cancelMyRegistration(member.id, id)

    expect(result).toMatchObject({ id, courseId: course.id, paid: 0, refund: 0 })
    const row = await registrationOf(id)
    expect(row).toMatchObject({ status: "cancelled", refundAmount: 0 })
    expect(row.cancelledAt).toBeInstanceOf(Date)
  })

  it.each([
    { left: 5 * DAY, percent: 100, refund: 150_000 },
    { left: 48 * HOUR, percent: 50, refund: 75_000 },
    { left: 10 * HOUR, percent: 0, refund: 0 },
  ])("refunds a paid registration $percent% when $left ms are left", async ({ left, percent, refund }) => {
    const course = await newCourse({}, left)
    const member = await newMember()
    const id = await paidRegistration(course.id, member.id)

    const result = await cancelMyRegistration(member.id, id)
    expect(result).toMatchObject({ paid: 150_000, percent, refund })
    expect(await registrationOf(id)).toMatchObject({ status: "cancelled", refundAmount: refund })
  })

  it("rounds a half refund down to a whole kuruş", async () => {
    const course = await newCourse({}, 48 * HOUR)
    const member = await newMember()
    const id = await paidRegistration(course.id, member.id, 99_999)
    expect((await cancelMyRegistration(member.id, id)).refund).toBe(49_999)
  })

  it("never cancels someone else's registration", async () => {
    const course = await newCourse()
    const owner = await newMember()
    const { id } = await registerForWorkshop(owner.id, await input(course.id))
    const stranger = await newMember()

    await rejectsWith(cancelMyRegistration(stranger.id, id), "registration.errors.notFound")
    expect((await registrationOf(id)).status).toBe("pending")
  })

  it("refuses twice, after the start, and for a cancelled workshop", async () => {
    const member = await newMember()
    const course = await newCourse()
    const { id } = await registerForWorkshop(member.id, await input(course.id))
    await cancelMyRegistration(member.id, id)
    await rejectsWith(cancelMyRegistration(member.id, id), "registration.errors.alreadyCancelled")

    const soon = await newCourse({}, 2 * HOUR)
    const late = await registerForWorkshop(member.id, await input(soon.id))
    await rejectsWith(cancelMyRegistration(member.id, late.id, new Date(Date.now() + 3 * HOUR)), "registration.errors.startedCancel")

    const other = await newCourse()
    const kept = await registerForWorkshop(member.id, await input(other.id))
    await db.update(courses).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(courses.id, other.id))
    await rejectsWith(cancelMyRegistration(member.id, kept.id), "registration.errors.cannotCancel")
  })
})

describe("emails", () => {
  const sent = () =>
    vi.mocked(sendEmail).mock.calls.map(
      ([email]) => email as { to: string; template: string; locale: string; props: Record<string, unknown> },
    )

  it("registration_received: in the member's language, with every payment way that is on", async () => {
    const course = await newCourse()
    const member = await newMember({ locale: "tr" })
    const { id } = await registerForWorkshop(member.id, await input(course.id, { participantName: "Deniz" }))
    expect(await sendRegistrationReceived(id)).toBe(true)

    const [email] = sent()
    expect(email).toMatchObject({
      to: member.email,
      template: "registration_received",
      locale: "tr",
      props: {
        name: "Ayşe Demir",
        participantName: "Deniz",
        workshopTitle: "Mum Yapımı",
        venue: "Moda Sanat Evi",
        accountUrl: `/tr/account/registrations/${id}`,
        cash: true,
        transfer: { accountHolder: "Lart Sanat", bankName: "Ziraat Bankası", iban: "TR330006100519786457841326" },
        paymentUrl: "https://iyzi.link/AKtest",
      },
    })
    expect(email.props.amount).toMatch(/1\.500/)
  })

  it("registration_received leaves out an unsafe payment link", async () => {
    const course = await newCourse({ paymentUrl: "http://pay.example.com/x" })
    const member = await newMember()
    const { id } = await registerForWorkshop(member.id, await input(course.id))
    await sendRegistrationReceived(id)
    expect(sent()[0].props.paymentUrl).toBeUndefined()
  })

  it("registration_confirmed for a free workshop", async () => {
    const course = await newCourse({ price: 0 })
    const member = await newMember()
    const { id } = await registerForWorkshop(member.id, await input(course.id))
    await sendRegistrationReceived(id)
    expect(sent()[0]).toMatchObject({ template: "registration_confirmed", props: { workshopUrl: `/en/workshops/${course.slug}` } })
  })

  it("cancelling unpaid: only the member is told, without a refund line", async () => {
    const course = await newCourse()
    const member = await newMember()
    const { id } = await registerForWorkshop(member.id, await input(course.id))
    await sendRegistrationCancelled(await cancelMyRegistration(member.id, id))

    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toMatchObject({ to: member.email, template: "registration_cancelled", props: { refundPercent: 100 } })
    expect(sent()[0].props).not.toHaveProperty("refundAmount")
  })

  it("cancelling paid: the member gets the refund amount and every active super admin a refund_due", async () => {
    const course = await newCourse({}, 48 * HOUR)
    const member = await newMember()
    const id = await paidRegistration(course.id, member.id)
    const away = await createAdmin(run, "Away Partner")
    await db.update(admins).set({ active: false }).where(eq(admins.id, away.id))

    await sendRegistrationCancelled(await cancelMyRegistration(member.id, id))
    const emails = sent()
    expect(emails[0]).toMatchObject({ template: "registration_cancelled", props: { refundPercent: 50 } })
    expect(emails[0].props.refundAmount).toMatch(/750/)

    const refundDue = emails.filter((e) => e.template === "refund_due")
    expect(refundDue.map((e) => e.to)).toContain(admin.email)
    expect(refundDue.map((e) => e.to)).not.toContain(away.email)
    expect(refundDue.find((e) => e.to === admin.email)?.props).toMatchObject({
      adminName: "Mina Partner",
      participantName: (await registrationOf(id)).participantName,
      // The refunds list, where "Mark as refunded" is.
      url: expect.stringMatching(/\/admin\/money\/refunds$/),
    })
  })

  it("cancelling paid with no refund left: the member is told, no refund_due", async () => {
    const course = await newCourse({}, 10 * HOUR)
    const member = await newMember()
    const id = await paidRegistration(course.id, member.id)
    await sendRegistrationCancelled(await cancelMyRegistration(member.id, id))
    expect(sent().map((e) => e.template)).toEqual(["registration_cancelled"])
    expect(sent()[0].props).toMatchObject({ refundPercent: 0 })
    expect(sent()[0].props.refundAmount).toMatch(/0/)
  })
})

describe("actions", () => {
  async function signIn(memberId: string) {
    const { token } = await createSession("member", memberId)
    request.cookies.set(sessionCookieName("member"), token)
  }

  it("register: opens the confirmation page and sends the email after the response", async () => {
    const course = await newCourse()
    const member = await newMember()
    await signIn(member.id)

    const error = await registerAction(await input(course.id)).catch((err: unknown) => err)
    expect(error).toMatchObject({ digest: expect.stringContaining(";/en/account/registrations/") })
    await Promise.all(request.afterTasks)
    expect(vi.mocked(sendEmail)).toHaveBeenCalledWith(expect.objectContaining({ template: "registration_received", to: member.email }))
  })

  it("register: a member whose email is not confirmed is asked to confirm it first", async () => {
    const course = await newCourse()
    const member = await newMember({ emailVerifiedAt: null })
    await signIn(member.id)

    const result = await registerAction(await input(course.id))
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/confirm your email/i) })
    expect(await seatsTaken(course.id)).toBe(0)
  })

  it("register: the terms box must be ticked", async () => {
    const course = await newCourse()
    const member = await newMember()
    await signIn(member.id)
    const result = await registerAction({ ...(await input(course.id)), acceptTerms: false as true })
    expect(result).toMatchObject({ ok: false, fieldErrors: { acceptTerms: expect.any(String) } })
  })

  it("cancel: someone else's registration is not found", async () => {
    const course = await newCourse()
    const owner = await newMember()
    const { id } = await registerForWorkshop(owner.id, await input(course.id))
    await signIn((await newMember()).id)

    const result = await cancelRegistrationAction({ id })
    expect(result).toMatchObject({ ok: false })
    expect((await registrationOf(id)).status).toBe("pending")
  })

  it("cancel: the member's own registration, with the emails after the response", async () => {
    const course = await newCourse()
    const member = await newMember()
    const id = await paidRegistration(course.id, member.id)
    await signIn(member.id)

    expect(await cancelRegistrationAction({ id })).toEqual({ ok: true, data: { paid: 150_000, refund: 150_000, percent: 100 } })
    await Promise.all(request.afterTasks)
    const templatesSent = vi.mocked(sendEmail).mock.calls.map(([e]) => (e as { template: string }).template)
    expect(templatesSent).toContain("registration_cancelled")
    expect(templatesSent).toContain("refund_due")
  })
})

describe("public pages", () => {
  it("list upcoming published and confirmed workshops with their places left", async () => {
    const open = await newCourse({ maxCapacity: 3 }, 3 * HOUR)
    const member = await newMember()
    await registerForWorkshop(member.id, await input(open.id))
    const paused = await newCourse({ status: "awaiting_signature" }, 3 * HOUR)
    const cancelled = await newCourse({ status: "cancelled", cancelledAt: new Date() }, 3 * HOUR)

    const list = await listOpenWorkshops("en")
    expect(list.find((w) => w.id === open.id)).toMatchObject({ title: "Candle making", venue: "Moda Art House", seatsLeft: 2, window: "open" })
    expect(list.map((w) => w.id)).not.toContain(paused.id)
    expect(list.map((w) => w.id)).not.toContain(cancelled.id)
  })

  it("show a workshop that was published, with public instructor fields only", async () => {
    const course = await newCourse({ status: "cancelled", cancelledAt: new Date() })
    const w = await getPublicWorkshop(course.slug, "fa")
    expect(w).toMatchObject({ id: course.id, title: "شمع‌سازی", window: "cancelled", paymentUrl: "https://iyzi.link/AKtest" })
    const [instructor] = await db.select().from(instructors).where(eq(instructors.id, instructorId))
    const text = JSON.stringify(w)
    for (const secret of [instructor.email, instructor.officialName, instructor.mobile, instructor.idNumberEnc]) {
      expect(text).not.toContain(secret)
    }

    const never = await newCourse({ status: "awaiting_signature", publishedAt: null })
    expect(await getPublicWorkshop(never.slug, "en")).toBeNull()
    expect(await getPublicWorkshop("../etc", "en")).toBeNull()
  })
})

describe("rules", () => {
  it("sameParticipant ignores spacing and case, Turkish letters too", () => {
    expect(sameParticipant("  İPEK   yılmaz", "ipek YILMAZ")).toBe(true)
    expect(sameParticipant("Deniz", "Denize")).toBe(false)
  })

  it("paymentWayNames: only the ways that are on and usable", () => {
    const payment = { cash: true, transfer: { enabled: true, iban: "" }, online: { enabled: true } }
    expect(paymentWayNames(payment, "https://iyzi.link/x")).toEqual(["cash", "online"])
    expect(paymentWayNames({ ...payment, transfer: { enabled: true, iban: "TR33" } }, null)).toEqual(["cash", "transfer"])
    expect(paymentWayNames({ ...payment, cash: false, online: { enabled: false } }, "https://iyzi.link/x")).toEqual([])
  })

  const base = {
    status: "published" as const,
    startsAt: new Date(Date.now() + 5 * DAY),
    endsAt: new Date(Date.now() + 5 * DAY + 2 * HOUR),
    registrationDeadline: new Date(Date.now() + 4 * DAY),
    seatsLeft: 3,
  }

  it("registrationWindow", () => {
    expect(registrationWindow(base)).toBe("open")
    expect(registrationWindow({ ...base, seatsLeft: 0 })).toBe("full")
    expect(registrationWindow({ ...base, registrationDeadline: new Date(Date.now() - 1) })).toBe("closed")
    expect(registrationWindow({ ...base, status: "awaiting_signature" })).toBe("paused")
    expect(registrationWindow({ ...base, status: "cancelled" })).toBe("cancelled")
    expect(registrationWindow({ ...base, status: "closed" })).toBe("past")
    expect(registrationWindow(base, new Date(base.startsAt.getTime() + 1))).toBe("started")
    expect(registrationWindow(base, new Date(base.endsAt.getTime() + 1))).toBe("past")
  })

  it("seatLimit: the maximum, and after the go decision the final number (never above the maximum)", () => {
    expect(seatLimit({ maxCapacity: 10, finalParticipants: null })).toBe(10)
    expect(seatLimit({ maxCapacity: 10, finalParticipants: 6 })).toBe(6)
    expect(seatLimit({ maxCapacity: 8, finalParticipants: 9 })).toBe(8)
    expect(seatLimit({ maxCapacity: 10, finalParticipants: 0 })).toBe(0)
  })

  it("cancelPreview: nothing to refund when not paid, or for a free workshop", () => {
    expect(cancelPreview({ status: "pending", amount: 150_000 }, base.startsAt)).toEqual({ paid: 0, percent: 100, refund: 0 })
    expect(cancelPreview({ status: "confirmed", amount: 0 }, base.startsAt)).toEqual({ paid: 0, percent: 100, refund: 0 })
    expect(cancelPreview({ status: "confirmed", amount: 150_000 }, base.startsAt)).toEqual({ paid: 150_000, percent: 100, refund: 150_000 })
  })

  it("safePaymentUrl: only plain https links", () => {
    expect(safePaymentUrl("https://iyzi.link/AKxyz")).toBe("https://iyzi.link/AKxyz")
    for (const bad of ["http://iyzi.link/x", "javascript:alert(1)", "https://user:pw@iyzi.link/x", "/tr/pay", "https://localhost/x", "", null]) {
      expect(safePaymentUrl(bad)).toBeUndefined()
    }
  })
})
