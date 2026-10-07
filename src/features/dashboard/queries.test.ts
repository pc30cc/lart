import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { TransactionRollbackError } from "drizzle-orm/errors"
import { describe, expect, it, vi } from "vitest"

import { db, type Tx } from "@/db"
import { admins, categories, courses, instructors, members, registrations, templates, type ClosedTotals } from "@/db/schema"
import { postContribution, postExpense, postTransaction, reverseTransaction } from "@/features/money/ledger"
import { getDashboard, type Dashboard } from "./queries"

const session = vi.hoisted(() => ({ sessionId: "test", admin: { id: "", email: "", name: "Dashboard", shareBp: 0 } }))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

/** Run `fn` in a transaction that is always rolled back: the shared test database stays as it was. */
async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  await db
    .transaction(async (tx) => {
      await fn(tx)
      tx.rollback()
    })
    .catch((err) => {
      if (!(err instanceof TransactionRollbackError)) throw err
    })
}

// Tuesday 6 October 2026, 12:00 in Istanbul.
const NOW = new Date("2026-10-06T09:00:00Z")
const at = (iso: string) => new Date(`${iso}+03:00`)
const tag = () => randomUUID().slice(0, 8)

async function seed(tx: Tx) {
  const [a, b, c, gone] = await tx
    .insert(admins)
    .values([
      { email: `dash-a-${tag()}@test.local`, name: "Ayla", passwordHash: "x", shareBp: 6000, createdAt: at("2020-01-01T00:00:00") },
      { email: `dash-b-${tag()}@test.local`, name: "Bora", passwordHash: "x", shareBp: 4000, createdAt: at("2020-01-02T00:00:00") },
      { email: `dash-c-${tag()}@test.local`, name: "Cem", passwordHash: "x", createdAt: at("2020-01-03T00:00:00") },
      { email: `dash-d-${tag()}@test.local`, name: "Deniz", passwordHash: "x", active: false, createdAt: at("2020-01-04T00:00:00") },
    ])
    .returning({ id: admins.id })
  const [category] = await tx.insert(categories).values({ slug: `dash-${tag()}`, name: { tr: "Mum" } }).returning()
  const instructor = (name: string) => ({
    email: `dash-${tag()}@test.local`,
    officialName: name,
    idNumberEnc: "v1.x.x.x",
    mobile: "+900000000000",
    displayName: { tr: name, en: name },
    teachingField: { tr: "Seramik" },
  })
  const [i1, i2] = await tx.insert(instructors).values([instructor("Elif"), instructor("Zehra")]).returning({ id: instructors.id })
  const [terms] = await tx.insert(templates).values({ kind: "terms", name: `t ${tag()}`, body: { tr: "x" } }).returning()
  const [member] = await tx.insert(members).values({ email: `dash-m-${tag()}@test.local`, name: "M", passwordHash: "x" }).returning()

  const course = async (
    title: string,
    o: {
      status: "awaiting_signature" | "published" | "confirmed" | "cancelled" | "closed"
      starts: string
      decision?: string
      min?: number
      max?: number
      instructorId?: string
      finalParticipants?: number
      closedTotals?: ClosedTotals
      price?: number
    },
  ) => {
    const startsAt = at(o.starts)
    const [row] = await tx
      .insert(courses)
      .values({
        slug: `dash-${tag()}`,
        status: o.status,
        categoryId: category.id,
        instructorId: o.instructorId ?? i1.id,
        title: { tr: title, en: title },
        venue: { tr: "Atölye" },
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
        minCapacity: o.min ?? 1,
        maxCapacity: o.max ?? 10,
        price: o.price ?? 15000,
        registrationDeadline: startsAt,
        decisionAt: o.decision ? at(o.decision) : startsAt,
        finalParticipants: o.finalParticipants ?? null,
        closedTotals: o.closedTotals ?? null,
        closedAt: o.status === "closed" ? NOW : null,
        createdBy: a.id,
      })
      .returning({ id: courses.id })
    return row.id
  }
  const totals = (netProfit: number, participants: number): ClosedTotals => ({
    revenue: 0, instructorFee: 0, expenses: 0, netProfit, participants, partners: [],
  })

  const w = {
    w1: await course("W1", { status: "closed", starts: "2026-08-10T10:00:00", closedTotals: totals(120_000, 8) }),
    // Posted as confirmed, closed below (a closed workshop's revenue is locked).
    w2: await course("W2", { status: "confirmed", starts: "2026-09-15T10:00:00", instructorId: i2.id }),
    w3: await course("W3", { status: "confirmed", starts: "2024-01-10T10:00:00" }),
    w4: await course("W4", { status: "confirmed", starts: "2026-10-01T10:00:00", max: 8, finalParticipants: 6 }),
    w5: await course("W5", { status: "published", starts: "2026-10-20T10:00:00", decision: "2026-10-05T18:00:00", min: 5, max: 12 }),
    w6: await course("W6", { status: "awaiting_signature", starts: "2026-10-25T10:00:00" }),
    w7: await course("W7", { status: "confirmed", starts: "2026-10-08T10:00:00", decision: "2026-10-04T10:00:00", finalParticipants: 9 }),
    w8: await course("W8", { status: "published", starts: "2026-10-12T10:00:00", decision: "2026-10-08T12:00:00", min: 2, max: 6 }),
    w9: await course("W9", { status: "cancelled", starts: "2026-10-02T10:00:00" }),
  }
  const register = (courseId: string, status: "pending" | "confirmed" | "cancelled", amount = 15000) =>
    tx.insert(registrations).values({
      courseId, memberId: member.id, participantName: "P", status, amount,
      termsTemplateId: terms.id, termsSha256: "0".repeat(64), termsAcceptedAt: NOW,
    })
  for (const status of ["confirmed", "confirmed", "confirmed", "pending", "cancelled"] as const) await register(w.w5, status)
  for (let i = 0; i < 2; i++) await register(w.w8, "confirmed")
  // W7 went ahead with 9; since then some cancelled and others registered: 7 active now.
  for (const status of ["confirmed", "confirmed", "confirmed", "confirmed", "confirmed", "pending", "pending", "cancelled"] as const) {
    await register(w.w7, status)
  }

  // Money. Revenue is posted directly (phase 2 posts it from registrations).
  const common = { description: "", createdBy: a.id }
  const income = (courseId: string, occurredOn: string, amount: number) =>
    postTransaction(tx, {
      ...common, kind: "registration_payment", occurredOn, courseId,
      lines: [{ account: "wallet", amount }, { account: "revenue", amount: -amount }],
    })
  await postContribution(tx, { ...common, occurredOn: "2026-09-03", partnerId: a.id, amount: 500_000 })
  await postContribution(tx, { ...common, occurredOn: "2026-09-03", partnerId: c.id, amount: 1_000 })
  await income(w.w3, "2025-10-15", 70_000) // before the 12-month window
  await income(w.w5, "2026-09-20", 30_000)
  await income(w.w5, "2026-10-02", 45_000)
  await postExpense(tx, { ...common, occurredOn: "2026-09-25", courseId: w.w4, amount: 8_000, source: { partnerId: b.id } })
  const general = await postExpense(tx, { ...common, occurredOn: "2026-10-03", amount: 5_000, source: "wallet" })
  await reverseTransaction(general, a.id, { tx, occurredOn: "2026-10-04" })
  // A closing entry moves a result to the partners: never counted as income again.
  await postTransaction(tx, {
    ...common, kind: "course_close", occurredOn: "2026-09-16", courseId: w.w2,
    lines: [
      { account: "revenue", amount: 10_000 },
      { account: "partner_capital", partnerId: a.id, amount: -6_000 },
      { account: "partner_capital", partnerId: b.id, amount: -4_000 },
    ],
  })
  await tx.update(courses).set({ status: "closed", closedAt: NOW, closedTotals: totals(-20_000, 4) }).where(eq(courses.id, w.w2))
  await tx.update(courses).set({ status: "closed", closedAt: NOW, closedTotals: totals(999, 2) }).where(eq(courses.id, w.w3))
  await tx.update(admins).set({ active: false }).where(eq(admins.id, c.id))

  return { partners: { a: a.id, b: b.id, c: c.id, gone: gone.id }, instructors: { i1: i1.id, i2: i2.id }, w, course, totals, register }
}

const month = (d: Dashboard, m: string) => d.months.find((x) => x.month === m)!

describe("dashboard queries", () => {
  it("adds up money, workshops and partners", async () => {
    await rolledBack(async (tx) => {
      const before = await getDashboard(NOW, tx)
      const { partners, instructors: ins, w } = await seed(tx)
      const d = await getDashboard(NOW, tx)

      // The last 12 months, this month last; closing entries and earlier months left out.
      expect(d.today).toBe("2026-10-06")
      expect(d.year).toBe(2026)
      expect(d.months.map((m) => m.month)).toEqual(before.months.map((m) => m.month))
      expect(d.months[0].month).toBe("2025-11-01")
      expect(d.months.at(-1)!.month).toBe("2026-10-01")
      const delta = (m: string) => {
        const [x, y] = [month(d, m), month(before, m)]
        return { revenue: x.revenue - y.revenue, expenses: x.expenses - y.expenses, net: x.net - y.net }
      }
      expect(delta("2026-09-01")).toEqual({ revenue: 30_000, expenses: 8_000, net: 22_000 })
      expect(delta("2026-10-01")).toEqual({ revenue: 45_000, expenses: 0, net: 45_000 }) // the expense was reversed
      expect(delta("2026-08-01")).toEqual({ revenue: 0, expenses: 0, net: 0 })

      expect(d.kpis.wallet - before.kpis.wallet).toBe(500_000 + 1_000 + 70_000 + 30_000 + 45_000)
      expect(d.kpis.revenueThisMonth - before.kpis.revenueThisMonth).toBe(45_000)
      expect(d.kpis.netThisYear - before.kpis.netThisYear).toBe(67_000)
      if (before.kpis.revenueLastMonth === 0) expect(d.kpis.revenueChange).toBe(0.5)

      // Upcoming: W7, W8, W5 open (13 of 28 seats: registered counts paid and not paid yet, live, also
      // after the go decision: W7 went ahead with 9 and has 7 now), W6 still awaiting signature.
      expect(d.kpis.upcoming - before.kpis.upcoming).toBe(4)
      expect(d.kpis.upcomingSeats - before.kpis.upcomingSeats).toBe(10 + 6 + 12)
      expect(d.kpis.upcomingTaken - before.kpis.upcomingTaken).toBe(7 + 2 + 4)
      // Held in the last 12 months: W1 (8/10), W2 (4/10), W4 (6/8, its go-decision number); W3 is older.
      expect(d.kpis.held - before.kpis.held).toBe(3)
      expect(d.kpis.heldSeats - before.kpis.heldSeats).toBe(28)
      expect(d.kpis.heldTaken - before.kpis.heldTaken).toBe(18)
      if (before.kpis.heldSeats === 0) expect(d.kpis.fillRate).toBeCloseTo(18 / 28)

      expect(d.attention.decisionsDue - before.attention.decisionsDue).toBe(1) // W5
      expect(d.attention.awaitingSignature - before.attention.awaitingSignature).toBe(1) // W6
      expect(d.attention.toClose - before.attention.toClose).toBe(2) // W4 ended, W9 cancelled

      const mine = new Set(Object.values(w))
      const upcoming = d.upcoming.filter((x) => mine.has(x.id))
      expect(upcoming.map((x) => [x.id, x.registered, x.alert?.kind ?? null])).toEqual([
        [w.w7, 7, null],
        [w.w8, 2, "decisionSoon"],
        [w.w5, 4, "decisionDue"],
        [w.w6, 0, "awaitingSignature"],
      ])
      // W5: 3 paid + 1 not paid yet registered (the cancelled one never counts), 1 short of the minimum of 5.
      expect(upcoming.find((x) => x.id === w.w5)).toMatchObject({ paid: 3, alert: { kind: "decisionDue", missing: 1 } })
      expect(upcoming.find((x) => x.id === w.w5)).toMatchObject({ payment: { kind: "paid", count: 3 } })
      expect(upcoming.find((x) => x.id === w.w8)).toMatchObject({ registered: 2, paid: 2, payment: { kind: "paid", count: 2 } })
      // W7: the live count (5 paid + 2 not yet), with the go-decision number beside it.
      expect(upcoming.find((x) => x.id === w.w7)).toMatchObject({ registered: 7, paid: 5, finalParticipants: 9 })
      expect(upcoming.find((x) => x.id === w.w6)).toMatchObject({ registered: 0, payment: null })
      expect(upcoming.find((x) => x.id === w.w8)!.alert).toEqual({ kind: "decisionSoon", at: at("2026-10-08T12:00:00"), missing: 0 })

      // Seats: held ones oldest first, then the open upcoming ones (never W6, W9).
      // The chart keeps a limited number of bars, so with other test files' workshops in the
      // shared test database only the ones that made the cut are compared, in order.
      const seats = d.seats.filter((x) => mine.has(x.id))
      expect(seats.some((x) => x.id === w.w6 || x.id === w.w9)).toBe(false)
      const expectedSeats: [string, number, number, boolean][] = [
        [w.w3, 2, 10, false],
        [w.w1, 8, 10, false],
        [w.w2, 4, 10, false],
        [w.w4, 6, 8, false],
        [w.w7, 7, 10, true],
        [w.w8, 2, 6, true],
        [w.w5, 4, 12, true],
      ]
      const shown = new Set(seats.map((x) => x.id))
      expect(seats.map((x) => [x.id, x.registered, x.maxCapacity, x.upcoming])).toEqual(
        expectedSeats.filter(([id]) => shown.has(id)),
      )
      if (before.seats.length === 0) expect(seats).toHaveLength(expectedSeats.length)

      // Profit from the locked figures of workshops closed in the window.
      expect(d.profit.workshops.filter((x) => mine.has(x.id)).map((x) => [x.id, x.netProfit])).toEqual([
        [w.w2, -20_000],
        [w.w1, 120_000],
      ])
      const byInstructor = d.profit.instructors.filter((x) => x.id === ins.i1 || x.id === ins.i2)
      expect(byInstructor.map((x) => [x.id, x.workshops, x.netProfit])).toEqual([
        [ins.i1, 1, 120_000],
        [ins.i2, 1, -20_000],
      ])

      // Partners: oldest first; a former partner only while they hold capital.
      const people = d.partners.filter((p) => Object.values(partners).includes(p.id))
      expect(people.map((p) => [p.id, p.shareBp, p.capital, p.active])).toEqual([
        [partners.a, 6000, 506_000, true],
        [partners.b, 4000, 12_000, true],
        [partners.c, 0, 1_000, false],
      ])

      expect(d.fresh).toBe(false)
      expect(d.blank).toBe(false)
      expect(d.setup.workshops - before.setup.workshops).toBe(9)
      expect(d.setup.instructors - before.setup.instructors).toBe(2)
      expect(d.setup.categories - before.setup.categories).toBe(1)
      expect(d.setup.ledger).toBe(true)
      expect(typeof d.setup.contract).toBe("boolean")
    })
  })

  it("never counts a free workshop's registrations as paid", async () => {
    await rolledBack(async (tx) => {
      const { course, register } = await seed(tx)
      const before = await getDashboard(NOW, tx)
      // Free: registrations are confirmed at once, with amount 0.
      const free = await course("Free", { status: "published", starts: "2026-10-07T10:00:00", decision: "2026-10-06T18:00:00", min: 2, max: 12, price: 0 })
      for (const status of ["confirmed", "confirmed", "confirmed", "cancelled"] as const) await register(free, status, 0)

      const d = await getDashboard(NOW, tx)
      expect(d.upcoming.find((x) => x.id === free)).toMatchObject({
        registered: 3,
        paid: 0,
        price: 0,
        payment: { kind: "free" },
        alert: { kind: "decisionSoon", missing: 0 },
      })
      expect(d.kpis.upcomingTaken - before.kpis.upcomingTaken).toBe(3)
      expect(d.kpis.upcomingSeats - before.kpis.upcomingSeats).toBe(12)
    })
  })

  it("never counts a cancelled workshop as held, even once its books are closed", async () => {
    await rolledBack(async (tx) => {
      const { course, totals } = await seed(tx)
      const before = await getDashboard(NOW, tx)
      const held = (d: Dashboard) => ({
        held: d.kpis.held,
        heldSeats: d.kpis.heldSeats,
        heldTaken: d.kpis.heldTaken,
        seats: d.seats.filter((x) => !x.upcoming).map((x) => x.id),
      })

      // Two cancelled workshops of 20 places whose dates have passed, not closed yet.
      const cancelled = (title: string) => course(title, { status: "cancelled", starts: "2026-09-28T10:00:00", max: 20 })
      const x = await cancelled("X")
      const y = await cancelled("Y")
      await tx.update(courses).set({ cancelledAt: at("2026-09-20T10:00:00") }).where(inArray(courses.id, [x, y]))
      const open = await getDashboard(NOW, tx)
      expect(held(open)).toEqual(held(before))
      expect(open.attention.toClose - before.attention.toClose).toBe(2)

      // Closed to book its costs: X as closeCourse does it (stays cancelled, closed_at set),
      // Y as it once did (status closed, cancelled_at kept).
      const lock = { closedAt: NOW, closedTotals: totals(-30_000, 0) }
      await tx.update(courses).set(lock).where(eq(courses.id, x))
      await tx.update(courses).set({ ...lock, status: "closed" }).where(eq(courses.id, y))
      const d = await getDashboard(NOW, tx)
      expect(held(d)).toEqual(held(before))
      expect(d.seats.some((s) => s.id === x || s.id === y)).toBe(false)
      expect(d.attention.toClose).toBe(before.attention.toClose)
      // Their booked costs still show in the profit rankings.
      expect(d.profit.workshops.filter((r) => r.id === x || r.id === y).map((r) => r.netProfit)).toEqual([-30_000, -30_000])
    })
  })

  it("starts blank on a fresh install", async () => {
    await rolledBack(async (tx) => {
      const d = await getDashboard(NOW, tx)
      // Only meaningful while the test database has no workshops and no money.
      if (d.setup.workshops > 0 || d.setup.ledger) return
      expect(d).toMatchObject({ fresh: true, blank: true, upcoming: [], seats: [] })
      expect(d.kpis).toMatchObject({ wallet: 0, revenueThisMonth: 0, revenueChange: null, netThisYear: 0, fillRate: null })
      expect(d.months.every((m) => m.revenue === 0 && m.expenses === 0)).toBe(true)
    })
  })
})
