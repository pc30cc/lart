"use server"

import { asc, eq, inArray, ne, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { admins } from "@/db/schema"
import { adminAction, UserError } from "@/lib/action"
import { getSetting } from "@/lib/settings"
import { closeCourse } from "./closing"
import {
  postAdvance,
  postContribution,
  postExpense,
  postInstructorPayment,
  postWithdrawal,
  reverseTransaction,
} from "./ledger"
import {
  advanceSchema,
  capitalSchema,
  closeSchema,
  expenseSchema,
  instructorPaymentSchema,
  reverseSchema,
  sharesSchema,
} from "./schema"

/**
 * Money mutations. Every one is a balanced ledger transaction (or a reversal),
 * written together with its audit entry in one database transaction.
 */

/** Money shows up across the panel (wallet, workshop finances, dashboard): refresh it all. */
function revalidate() {
  revalidatePath("/[locale]/admin", "layout")
}

/**
 * Only the partner chosen in Settings → Money pays the business's costs from
 * the wallet (expenses, instructors' advances and fees): anyone else is refused,
 * and so is everyone while nobody is chosen.
 */
async function assertSpender(adminId: string) {
  const { spenderId } = await getSetting("money")
  if (spenderId === adminId) return
  if (!spenderId) throw new UserError("money.errors.noSpender")
  const [spender] = await db.select({ name: admins.name }).from(admins).where(eq(admins.id, spenderId))
  throw new UserError("money.errors.notSpender", { values: { name: spender?.name ?? "" } })
}

/** A partner puts money into the wallet, or takes money out (only while Settings → Money allows it). */
export const recordCapital = adminAction(capitalSchema, async ({ direction, partnerId, amount, occurredOn, note }, ctx) => {
  if (direction === "withdrawal" && !(await getSetting("money")).withdrawals) throw new UserError("money.errors.withdrawalsClosed")
  const id = await db.transaction(async (tx) => {
    const post = direction === "contribution" ? postContribution : postWithdrawal
    const id = await post(tx, { partnerId, amount, occurredOn, description: note, createdBy: ctx.admin.id })
    await ctx.audit(
      { action: `money.${direction}`, entity: "ledger_transaction", entityId: id, data: { partnerId, amount, occurredOn, note } },
      tx,
    )
    return id
  })
  revalidate()
  return { id }
})

/** An expense of a workshop (`courseId`) or of the business, paid from the wallet or out of the advance; recorded by the spender. */
export const recordExpense = adminAction(expenseSchema, async ({ courseId, category, amount, occurredOn, source }, ctx) => {
  await assertSpender(ctx.admin.id)
  const id = await db.transaction(async (tx) => {
    const id = await postExpense(tx, {
      courseId,
      amount,
      occurredOn,
      description: category,
      source,
      createdBy: ctx.admin.id,
    })
    await ctx.audit(
      {
        action: "money.expense",
        entity: "ledger_transaction",
        entityId: id,
        data: { courseId, category, amount, occurredOn, paidFrom: source },
      },
      tx,
    )
    return id
  })
  revalidate()
  return { id }
})

/** An advance paid to a workshop's instructor from the wallet (by the spender), or returned by them to it. */
export const recordAdvance = adminAction(advanceSchema, async ({ courseId, direction, amount, occurredOn, note }, ctx) => {
  if (direction === "paid") await assertSpender(ctx.admin.id)
  const id = await db.transaction(async (tx) => {
    const id = await postAdvance(tx, {
      courseId,
      direction,
      amount,
      occurredOn,
      description: note,
      createdBy: ctx.admin.id,
    })
    await ctx.audit(
      {
        action: `money.advance_${direction}`,
        entity: "ledger_transaction",
        entityId: id,
        data: { courseId, amount, occurredOn, note },
      },
      tx,
    )
    return id
  })
  revalidate()
  return { id }
})

/** Pay the instructor what a closed workshop still owes them (or part of it), from the wallet; by the spender. */
export const payInstructor = adminAction(instructorPaymentSchema, async ({ courseId, amount, occurredOn, note }, ctx) => {
  await assertSpender(ctx.admin.id)
  const id = await db.transaction(async (tx) => {
    const id = await postInstructorPayment(tx, {
      courseId,
      amount,
      occurredOn,
      description: note,
      createdBy: ctx.admin.id,
    })
    await ctx.audit(
      {
        action: "money.instructor_payment",
        entity: "ledger_transaction",
        entityId: id,
        data: { courseId, amount, occurredOn, note },
      },
      tx,
    )
    return id
  })
  revalidate()
  return { id }
})

/** Close a workshop: settlement + profit to the partners, figures locked; "closed", or still "cancelled" with `closed_at`. */
export const closeWorkshop = adminAction(closeSchema, async ({ courseId, ...expected }, ctx) => {
  const totals = await db.transaction(async (tx) => {
    const totals = await closeCourse(tx, courseId, ctx.admin.id, expected)
    await ctx.audit({ action: "workshop.close", entity: "workshop", entityId: courseId, data: totals }, tx)
    return totals
  })
  revalidate()
  return { netProfit: totals.netProfit }
})

/** Correct a mistake: post the mirror image of a transaction. */
export const reverseEntry = adminAction(reverseSchema, async ({ id }, ctx) => {
  const reversal = await db.transaction(async (tx) => {
    const reversal = await reverseTransaction(id, ctx.admin.id, { tx })
    await ctx.audit(
      {
        action: "money.reverse",
        entity: "ledger_transaction",
        entityId: id,
        data: { reversalId: reversal.id, kind: reversal.original.kind, courseId: reversal.original.courseId },
      },
      tx,
    )
    return reversal
  })
  revalidate()
  return { id: reversal.id }
})

/**
 * Set the partners' profit shares. The listed people (one to three active
 * admins) are the partners and together hold exactly 100 %; everyone else
 * holds 0 %. Workshops closed earlier keep the shares they were closed with.
 */
export const updateShares = adminAction(sharesSchema, async ({ shares }, ctx) => {
  await db.transaction(async (tx) => {
    // One change of shares at a time. Then only the people whose share can change are locked (current
    // partners and the listed people), in id order: locking every admin row deadlocked with transactions
    // that reference admins (audit entries, ledger lines).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('admins:shares'))`)
    const everyone = await tx
      .select({ id: admins.id, name: admins.name, active: admins.active, shareBp: admins.shareBp })
      .from(admins)
      .where(or(ne(admins.shareBp, 0), inArray(admins.id, shares.map((s) => s.adminId))))
      .orderBy(asc(admins.id))
      .for("update")
    const byId = new Map(everyone.map((a) => [a.id, a]))
    if (shares.some((s) => !byId.get(s.adminId)?.active)) throw new UserError("money.partners.partnerGone")

    const next = new Map(shares.map((s) => [s.adminId, s.shareBp]))
    const changed: Record<string, { name: string; from: number; to: number }> = {}
    for (const person of everyone) {
      const to = next.get(person.id) ?? 0
      if (to === person.shareBp) continue
      await tx.update(admins).set({ shareBp: to }).where(eq(admins.id, person.id))
      changed[person.id] = { name: person.name, from: person.shareBp, to }
    }
    if (Object.keys(changed).length) {
      await ctx.audit({ action: "partner.shares", entity: "admin", data: changed }, tx)
    }
  })
  revalidate()
  return undefined
})
