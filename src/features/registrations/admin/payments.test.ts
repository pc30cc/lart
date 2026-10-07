import { randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { parseTableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { auditLog, courses, ledgerLines, ledgerTransactions, members, registrations } from "@/db/schema"
import { cancelWorkshop } from "@/features/workshops/actions"
import { addRegistration, createAdmin, createCategory, createInstructor, createMember, createTermsTemplate, runId } from "@/features/workshops/test-fixtures"
import { getSetting, setSetting, type SettingValue } from "@/lib/settings"
import { cleanIban, ibanChecksumOk, ibanProblem } from "@/features/settings/payments"
import { cancelRegistrationAction, markRefundedAction, recordPaymentAction, savePaymentSettings } from "./actions"
import { listRefunds, listWorkshopRegistrations, registrationSummary } from "./queries"
import { refundTable, registrationTable } from "./schema"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../../messages/en/common.json")).default,
    workshops: (await import("../../../../messages/en/workshops.json")).default,
    money: (await import("../../../../messages/en/money.json")).default,
    settings: (await import("../../../../messages/en/settings.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
const background = vi.hoisted(() => [] as Promise<unknown>[])
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void background.push(Promise.resolve().then(fn)) }))
type Sent = { to: string; template: string; locale: string; idempotencyKey?: string; props: Record<string, unknown> }
const sendEmail = vi.hoisted(() => vi.fn<(input: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true })))
vi.mock("@/lib/email", () => ({ sendEmail }))
const session = vi.hoisted(() => ({ sessionId: "test", admin: { id: "", email: "", name: "Payments Tester", shareBp: 0 } }))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const run = runId()
const HOUR = 3_600_000
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date())
let refs: { categoryId: string; instructorId: string; termsId: string }

beforeAll(async () => {
  const [admin, category, instructor, terms] = await Promise.all([
    createAdmin(run, "Payments Tester"),
    createCategory(run),
    createInstructor(run),
    createTermsTemplate(run),
  ])
  Object.assign(session.admin, { id: admin.id, email: admin.email })
  refs = { categoryId: category.id, instructorId: instructor.id, termsId: terms.id }
})

// Ledger rows are append-only: the workshops, registrations and members they reference stay in the test database.
afterAll(async () => {
  await Promise.all(background)
})

beforeEach(() => {
  sendEmail.mockReset()
  sendEmail.mockResolvedValue({ ok: true })
})

/** A published workshop starting in `startsInHours`. */
async function workshop(startsInHours = 14 * 24, price = 150_000) {
  const start = new Date(Date.now() + startsInHours * HOUR)
  const [row] = await db
    .insert(courses)
    .values({
      slug: `pay-${run}-${randomUUID().slice(0, 8)}`,
      status: "published",
      categoryId: refs.categoryId,
      instructorId: refs.instructorId,
      title: { tr: `Seramik ${run}`, en: "Ceramics", fa: "سرامیک" },
      venue: { tr: "Atölye" },
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * HOUR),
      minCapacity: 2,
      maxCapacity: 10,
      price,
      registrationDeadline: new Date(start.getTime() - HOUR),
      decisionAt: new Date(start.getTime() - 2 * HOUR),
      publishedAt: new Date(),
      createdBy: session.admin.id,
    })
    .returning()
  return row
}

async function member(locale = "tr", name = "Ayşe") {
  const row = await createMember(run, name)
  if (locale !== "tr") await db.update(members).set({ locale }).where(eq(members.id, row.id))
  return { ...row, locale }
}

async function register(courseId: string, memberId: string, options: Parameters<typeof addRegistration>[3] = {}) {
  const status = options.status ?? "pending"
  const row = await addRegistration(courseId, memberId, refs.termsId, { ...options, status })
  return row
}

const registration = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0]
const ledgerOf = (registrationId: string) =>
  db
    .select({ id: ledgerTransactions.id, kind: ledgerTransactions.kind, occurredOn: ledgerTransactions.occurredOn, createdBy: ledgerTransactions.createdBy })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.registrationId, registrationId))
const walletOf = async (transactionId: string) =>
  (
    await db
      .select({ amount: ledgerLines.amount })
      .from(ledgerLines)
      .where(and(eq(ledgerLines.transactionId, transactionId), eq(ledgerLines.account, "wallet")))
  )[0]?.amount
const lastAudit = async (entityId: string) =>
  (await db.select().from(auditLog).where(eq(auditLog.entityId, entityId)).orderBy(desc(auditLog.at)).limit(1))[0]
const emails = (template: string) => sendEmail.mock.calls.map((c) => c[0] as Sent).filter((m) => m.template === template)

const pay = (id: string, amount = 150_000, method: "cash" | "transfer" | "online" = "cash", paidOn = today()) =>
  recordPaymentAction({ id, method, amount, paidOn })

describe("record payment", () => {
  it("marks a registration paid, posts the income once, audits it and emails the member in their language", async () => {
    const w = await workshop()
    const person = await member("fa", "Mina")
    const r = await register(w.id, person.id)

    expect(await pay(r.id, 150_000, "transfer")).toEqual({ ok: true, data: { id: r.id, method: "transfer" } })
    await Promise.all(background)

    expect(await registration(r.id)).toMatchObject({ status: "confirmed", paymentMethod: "transfer", paidAt: expect.any(Date) })
    const ledger = await ledgerOf(r.id)
    expect(ledger).toEqual([expect.objectContaining({ kind: "registration_payment", occurredOn: today(), createdBy: session.admin.id })])
    expect(await walletOf(ledger[0].id)).toBe(150_000)
    expect(await lastAudit(r.id)).toMatchObject({
      action: "registration.payment",
      adminId: session.admin.id,
      data: { courseId: w.id, method: "transfer", amount: 150_000, paidOn: today() },
    })

    const [mail] = emails("payment_received")
    expect(mail).toMatchObject({
      to: person.email,
      locale: "fa",
      idempotencyKey: `payment_received:${r.id}`,
      props: { name: "Mina", workshopTitle: "سرامیک", method: "transfer", accountUrl: `/fa/account/registrations/${r.id}` },
    })
    expect(String(mail.props.amount)).toMatch(/[۰-۹]/) // Persian digits
  })

  it("refuses a second payment politely, also when two admins press at the same moment", async () => {
    const w = await workshop()
    const person = await member()
    const r = await register(w.id, person.id)

    const results = await Promise.all([pay(r.id), pay(r.id)])
    expect(results.filter((x) => x.ok)).toHaveLength(1)
    expect(results.find((x) => !x.ok)).toMatchObject({ ok: false, error: "This registration is already paid. There’s nothing more to do." })
    expect(await pay(r.id)).toMatchObject({ ok: false, error: expect.stringContaining("already paid") })
    expect(await ledgerOf(r.id)).toHaveLength(1)
  })

  it("refuses a wrong amount, a cancelled or free registration, a future date and a date before the registration", async () => {
    const w = await workshop()
    const person = await member()
    const r = await register(w.id, person.id)
    expect(await pay(r.id, 100_000)).toMatchObject({ ok: false, error: expect.stringContaining("doesn’t match") })

    const tomorrow = new Date(Date.now() + 36 * HOUR).toISOString().slice(0, 10)
    expect(await pay(r.id, 150_000, "cash", tomorrow)).toMatchObject({ ok: false, fieldErrors: { paidOn: expect.any(String) } })
    expect(await pay(r.id, 150_000, "cash", "2020-01-01")).toMatchObject({
      ok: false,
      error: "The payment date can’t be before the day they registered.",
    })

    const cancelled = await register(w.id, person.id, { status: "cancelled" })
    expect(await pay(cancelled.id)).toMatchObject({ ok: false, error: expect.stringContaining("cancelled") })
    const free = await register(w.id, person.id, { status: "confirmed", amount: 0 })
    expect(await pay(free.id, 0)).toMatchObject({ ok: false })
    expect(await ledgerOf(r.id)).toHaveLength(0)
    expect(await registration(r.id)).toMatchObject({ status: "pending", paidAt: null, paymentMethod: null })
  })

  it("refuses an unknown registration and invalid input", async () => {
    expect(await pay(randomUUID())).toMatchObject({ ok: false, error: expect.stringContaining("couldn’t find") })
    expect(await recordPaymentAction({ id: "nope", method: "cash", amount: 1, paidOn: today() })).toMatchObject({ ok: false })
    expect(await recordPaymentAction({ id: randomUUID(), method: "card" as never, amount: 1, paidOn: today() })).toMatchObject({
      ok: false,
      fieldErrors: { method: "Please choose how it was paid." },
    })
  })
})

describe("cancel registration", () => {
  it("cancels an unpaid registration with nothing to refund", async () => {
    const w = await workshop()
    const person = await member("en", "Leyla")
    const r = await register(w.id, person.id)

    expect(await cancelRegistrationAction({ id: r.id, refund: "full" })).toEqual({ ok: true, data: { id: r.id, refund: 0 } })
    await Promise.all(background)
    expect(await registration(r.id)).toMatchObject({ status: "cancelled", refundAmount: 0, cancelledAt: expect.any(Date) })
    const [mail] = emails("registration_cancelled")
    expect(mail).toMatchObject({ to: person.email, locale: "en", props: { refundPercent: 100 } })
    expect(mail.props).not.toHaveProperty("refundAmount")
    expect(await lastAudit(r.id)).toMatchObject({ action: "registration.cancel", data: { paid: 0, refundAmount: 0 } })

    expect(await cancelRegistrationAction({ id: r.id, refund: "terms" })).toMatchObject({
      ok: false,
      error: "This registration is already cancelled.",
    })
  })

  it("refunds a paid registration under the terms (50 % between 72 and 24 hours) or in full", async () => {
    const w = await workshop(48)
    const person = await member()
    const [a, b] = [await register(w.id, person.id), await register(w.id, person.id)]
    await pay(a.id)
    await pay(b.id)

    expect(await cancelRegistrationAction({ id: a.id, refund: "terms" })).toEqual({ ok: true, data: { id: a.id, refund: 75_000 } })
    expect(await cancelRegistrationAction({ id: b.id, refund: "full" })).toEqual({ ok: true, data: { id: b.id, refund: 150_000 } })
    await Promise.all(background)

    expect(await registration(a.id)).toMatchObject({ status: "cancelled", refundAmount: 75_000, refundedAt: null, paidAt: expect.any(Date) })
    expect(await registration(b.id)).toMatchObject({ status: "cancelled", refundAmount: 150_000 })
    const mails = emails("registration_cancelled")
    expect(mails.find((m) => m.idempotencyKey === `registration_cancelled:${a.id}`)?.props).toMatchObject({ refundPercent: 50, refundAmount: "₺750" })
    expect(mails.find((m) => m.idempotencyKey === `registration_cancelled:${b.id}`)?.props).toMatchObject({ refundPercent: 100 })
    // Nothing is paid back yet: the ledger still has only the payments.
    expect((await ledgerOf(a.id)).map((t) => t.kind)).toEqual(["registration_payment"])
  })

  it("gives nothing back under the terms less than 24 hours before the start", async () => {
    const w = await workshop(10)
    const person = await member()
    const r = await register(w.id, person.id)
    await pay(r.id)
    expect(await cancelRegistrationAction({ id: r.id, refund: "terms" })).toEqual({ ok: true, data: { id: r.id, refund: 0 } })
  })
})

describe("refunds", () => {
  it("lists the refunds owed, pays one back once (also when pressed twice at once) and emails the person", async () => {
    const w = await workshop()
    const person = await member("tr", "Selin")
    const r = await register(w.id, person.id)
    await pay(r.id)
    await cancelRegistrationAction({ id: r.id, refund: "full" })

    const owed = await listRefunds(parseTableParams({ q: person.email }, { sort: refundTable.sort, defaultSort: "cancelledAt", filters: refundTable.filters }))
    expect(owed.rows.map((x) => x.id)).toEqual([r.id])
    expect(owed.rows[0]).toMatchObject({ refundAmount: 150_000, paymentMethod: "cash", member: { name: "Selin" } })

    sendEmail.mockClear()
    const results = await Promise.all([
      markRefundedAction({ id: r.id, method: "transfer", refundedOn: today() }),
      markRefundedAction({ id: r.id, method: "transfer", refundedOn: today() }),
    ])
    await Promise.all(background)
    expect(results.filter((x) => x.ok)).toEqual([{ ok: true, data: { id: r.id, amount: 150_000 } }])
    expect(results.find((x) => !x.ok)).toMatchObject({ error: "This refund is already marked as paid back. Nothing more to do." })

    const ledger = await ledgerOf(r.id)
    expect(ledger.map((t) => t.kind).sort()).toEqual(["registration_payment", "registration_refund"])
    expect(await walletOf(ledger.find((t) => t.kind === "registration_refund")!.id)).toBe(-150_000)
    expect(await registration(r.id)).toMatchObject({ refundedAt: expect.any(Date) })
    expect(await lastAudit(r.id)).toMatchObject({ action: "registration.refund", data: { amount: 150_000, method: "transfer" } })
    expect(emails("refund_sent")).toEqual([
      expect.objectContaining({ to: person.email, locale: "tr", idempotencyKey: `refund_sent:${r.id}`, props: expect.objectContaining({ amount: "₺1.500" }) }),
    ])

    const after = await listRefunds(parseTableParams({ q: person.email }, { sort: refundTable.sort, defaultSort: "cancelledAt", filters: refundTable.filters }))
    expect(after.rows).toHaveLength(0)
    const done = await listRefunds(
      parseTableParams({ q: person.email, view: "refunded" }, { sort: refundTable.sort, defaultSort: "cancelledAt", filters: refundTable.filters }),
    )
    expect(done.rows.map((x) => x.id)).toEqual([r.id])
  })

  it("refuses to pay back what is not owed", async () => {
    const w = await workshop()
    const person = await member()
    const unpaid = await register(w.id, person.id)
    expect(await markRefundedAction({ id: unpaid.id, method: "cash", refundedOn: today() })).toMatchObject({
      ok: false,
      error: "Nothing is owed back on this registration.",
    })
    await cancelRegistrationAction({ id: unpaid.id, refund: "full" })
    expect(await markRefundedAction({ id: unpaid.id, method: "cash", refundedOn: today() })).toMatchObject({ ok: false })
    expect(await ledgerOf(unpaid.id)).toHaveLength(0)
  })

  it("owes every payer a full refund when the workshop is cancelled; unpaid ones owe nothing but are told too", async () => {
    const w = await workshop(48)
    const [payer, other] = [await member("en", "Payer"), await member()]
    const paid = await register(w.id, payer.id)
    const unpaid = await register(w.id, other.id)
    await pay(paid.id, 150_000, "online")

    expect(await cancelWorkshop({ id: w.id })).toMatchObject({ ok: true, data: { cancelledRegistrations: 2, emailed: 2 } })
    await Promise.all(background)
    expect(await registration(paid.id)).toMatchObject({ status: "cancelled", refundAmount: 150_000 })
    expect(await registration(unpaid.id)).toMatchObject({ status: "cancelled", refundAmount: 0 })
    const told = emails("workshop_cancelled")
    expect(told).toHaveLength(2)
    expect(told.find((m) => m.to === payer.email)).toMatchObject({
      locale: "en",
      props: expect.objectContaining({ refundAmount: expect.any(String), workshopsUrl: "/en/workshops" }),
    })
    // Not paid yet: no refund line, so the email says the workshop won't take place instead.
    expect(told.find((m) => m.to === other.email)?.props).not.toHaveProperty("refundAmount")

    const owed = await listRefunds(parseTableParams({ q: payer.email }, { sort: refundTable.sort, defaultSort: "cancelledAt", filters: refundTable.filters }))
    expect(owed.rows.map((x) => x.id)).toEqual([paid.id])
    expect(await markRefundedAction({ id: paid.id, method: "cash", refundedOn: today() })).toMatchObject({ ok: true })
    // A cancelled registration can't be paid any more.
    expect(await pay(unpaid.id)).toMatchObject({ ok: false })
  })
})

describe("registrations list", () => {
  it("filters by payment and adds up the totals", async () => {
    const w = await workshop()
    const person = await member("tr", "Zehra")
    const [a, b, c] = [await register(w.id, person.id), await register(w.id, person.id), await register(w.id, person.id)]
    await pay(a.id)
    await cancelRegistrationAction({ id: c.id, refund: "terms" })

    const params = (filters: Record<string, string>) =>
      parseTableParams(filters, { sort: registrationTable.sort, defaultSort: "createdAt", filters: registrationTable.filters })
    expect((await listWorkshopRegistrations(w.id, params({ status: "paid" }))).rows.map((r) => r.id)).toEqual([a.id])
    expect((await listWorkshopRegistrations(w.id, params({ status: "unpaid" }))).rows.map((r) => r.id)).toEqual([b.id])
    expect((await listWorkshopRegistrations(w.id, params({ status: "cancelled" }))).rows.map((r) => r.id)).toEqual([c.id])
    expect((await listWorkshopRegistrations(w.id, params({ q: "zehra" }))).total).toBe(3)

    expect(await registrationSummary(w.id)).toMatchObject({
      active: 2,
      paid: 1,
      paidAmount: 150_000,
      unpaid: 1,
      unpaidAmount: 150_000,
      cancelled: 1,
      refundsOwed: 0,
    })
  })
})

describe("payment settings", () => {
  let saved: SettingValue<"payment">
  beforeAll(async () => {
    saved = await getSetting("payment")
  })
  afterAll(async () => {
    await setSetting("payment", saved)
  })

  const valid = {
    cash: true,
    transfer: { enabled: true, accountHolder: "Lart Sanat", bankName: "Ziraat", iban: "tr33 0006 1005 1978 6457 8413 26", note: { fa: "", tr: "Açıklamaya adınızı yazın", en: "" } },
    online: { enabled: false, note: { fa: "", tr: "", en: "" } },
  }

  it("checks Turkish IBANs with their checksum", () => {
    expect(cleanIban("tr33 0006 1005 1978 6457 8413 26")).toBe("TR330006100519786457841326")
    expect(cleanIban("TR۳۳ ۰۰۰۶ 1005 1978 6457 8413 26")).toBe("TR330006100519786457841326")
    expect(ibanChecksumOk("TR330006100519786457841326")).toBe(true)
    expect(ibanProblem("TR330006100519786457841326")).toBeNull()
    expect(ibanProblem("TR330006100519786457841327")).toBe("settings.payments.errors.ibanChecksum")
    expect(ibanProblem("TR3300061005197864578413")).toBe("settings.payments.errors.ibanLength")
    expect(ibanProblem("DE89370400440532013000")).toBe("settings.payments.errors.ibanCountry")
  })

  it("saves the ways to pay with a valid IBAN, audited, and refuses a mistyped IBAN or every way off", async () => {
    expect(await savePaymentSettings(valid)).toEqual({ ok: true, data: { changed: true } })
    expect(await getSetting("payment")).toMatchObject({ transfer: { enabled: true, iban: "TR330006100519786457841326", note: { tr: "Açıklamaya adınızı yazın" } } })
    expect(await lastAudit("payment")).toMatchObject({ action: "setting.update", entity: "setting" })
    expect(await savePaymentSettings(valid)).toEqual({ ok: true, data: { changed: false } })

    expect(await savePaymentSettings({ ...valid, transfer: { ...valid.transfer, iban: "TR33 0006 1005 1978 6457 8413 27" } })).toMatchObject({
      ok: false,
      fieldErrors: { "transfer.iban": "This IBAN doesn’t add up: a digit may be mistyped. Please check it." },
    })
    expect(await savePaymentSettings({ ...valid, transfer: { ...valid.transfer, accountHolder: "", iban: "" } })).toMatchObject({
      ok: false,
      fieldErrors: { "transfer.accountHolder": expect.any(String), "transfer.iban": "Please write the IBAN." },
    })
    expect(
      await savePaymentSettings({ ...valid, cash: false, transfer: { ...valid.transfer, enabled: false }, online: { ...valid.online, enabled: false } }),
    ).toMatchObject({ ok: false, fieldErrors: { cash: "Please keep at least one way to pay switched on." } })
  })
})
