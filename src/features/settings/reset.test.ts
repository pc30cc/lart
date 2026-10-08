import { eq, inArray, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "@/db"
import { auditLog, contracts, courses, ledgerLines, ledgerTransactions, registrations } from "@/db/schema"
import { postContribution, postRegistrationPayment, today } from "@/features/money/ledger"
import { addRegistration, makeAdmin, makeCourse, makeWorld } from "@/features/money/testing"
import { resetPreview, runFactoryReset } from "./reset"

// Its own database (vitest.config.ts, project "reset"): it empties the whole ledger.
describe("factory reset", () => {
  it("empties the ledger, deletes unsigned contracts and those of workshops not held, and the money rows of the log; nothing else", async () => {
    const partner = await makeAdmin("Partner", 10_000)
    const world = await makeWorld()
    const DAY = 86_400_000
    const held = await makeCourse(world, partner.id, { status: "confirmed", endsAt: new Date(Date.now() - DAY) })
    const heldUnsigned = await makeCourse(world, partner.id, { status: "confirmed", endsAt: new Date(Date.now() - DAY), contractStatus: "sent" })
    const upcoming = await makeCourse(world, partner.id, { status: "published", endsAt: new Date(Date.now() + 7 * DAY) })
    const cancelled = await makeCourse(world, partner.id, { status: "cancelled", endsAt: new Date(Date.now() - DAY) })
    const registration = await addRegistration(world, held)

    await db.transaction(async (tx) => {
      await postContribution(tx, { occurredOn: today(), description: "Capital", createdBy: partner.id, partnerId: partner.id, amount: 500_000 })
      await postRegistrationPayment(tx, { occurredOn: today(), createdBy: partner.id, registrationId: registration })
    })
    const contractOf = async (courseId: string) =>
      (await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.courseId, courseId)))[0]?.id
    const upcomingContract = await contractOf(upcoming)
    await db.insert(auditLog).values([
      { adminId: partner.id, action: "money.expense", entity: "ledger_transaction" },
      { adminId: partner.id, action: "registration.payment", entity: "registration", entityId: registration },
      { adminId: partner.id, action: "contract.resend", entity: "contract", entityId: upcomingContract },
      { adminId: partner.id, action: "contract.sign", entity: "contract", entityId: await contractOf(held) },
      { adminId: partner.id, action: "workshop.update", entity: "workshop", entityId: upcoming },
    ])

    // Outside a reset the ledger and the log stay append-only.
    await expect(db.delete(ledgerLines)).rejects.toThrow()
    await expect(db.delete(auditLog)).rejects.toThrow()

    const preview = await resetPreview()
    expect(preview).toEqual({ transactions: 2, contracts: 3, auditRows: 3 })
    const removed = await db.transaction((tx) => runFactoryReset(tx))
    expect(removed).toEqual(preview)

    expect(await db.$count(ledgerTransactions)).toBe(0)
    expect(await db.$count(ledgerLines)).toBe(0)
    // The held workshop's signed contract stays; the unsigned one, the upcoming and the cancelled workshop's go.
    expect(await contractOf(held)).toBeDefined()
    expect(await contractOf(heldUnsigned)).toBeUndefined()
    expect(await contractOf(upcoming)).toBeUndefined()
    expect(await contractOf(cancelled)).toBeUndefined()
    // Workshops and registrations stay.
    expect(await db.$count(courses, inArray(courses.id, [held, heldUnsigned, upcoming, cancelled]))).toBe(4)
    expect(await db.$count(registrations, eq(registrations.id, registration))).toBe(1)
    const mine = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.adminId, partner.id))
    expect(mine.map((r) => r.action).sort()).toEqual(["contract.sign", "workshop.update"])

    // And the guard is back on once the reset's transaction is over.
    await db.insert(auditLog).values({ adminId: partner.id, action: "workshop.update", entity: "workshop" })
    await expect(db.execute(sql`delete from audit_log`)).rejects.toThrow()
  })
})
