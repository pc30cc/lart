"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { admins } from "@/db/schema"
import { adminAction, UserError } from "@/lib/action"
import { getSetting } from "@/lib/settings"
import { activePartners, closeCourse } from "./closing"
import {
  postAdvance,
  postExpense,
  postInstructorPayment,
  postJointContribution,
  postWithdrawal,
  reverseTransaction,
} from "./ledger"
import {
  advanceSchema,
  closeSchema,
  contributionSchema,
  expenseSchema,
  instructorPaymentSchema,
  reverseSchema,
  withdrawalSchema,
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

/**
 * Capital goes in from every partner at once, the same amount each (the
 * shares are equal and locked): one transaction, one line per active partner.
 */
export const recordContribution = adminAction(contributionSchema, async ({ amount, occurredOn, note }, ctx) => {
  const id = await db.transaction(async (tx) => {
    const partners = (await activePartners(tx, true)).filter((p) => p.shareBp > 0)
    if (partners.length === 0) throw new UserError("money.errors.partnerGone")
    const partnerIds = partners.map((p) => p.adminId)
    const id = await postJointContribution(tx, { partnerIds, amountEach: amount, occurredOn, description: note, createdBy: ctx.admin.id })
    await ctx.audit(
      {
        action: "money.contribution",
        entity: "ledger_transaction",
        entityId: id,
        data: { partners: partnerIds, amountEach: amount, total: amount * partnerIds.length, occurredOn, note },
      },
      tx,
    )
    return id
  })
  revalidate()
  return { id }
})

/** A partner takes money out of the wallet: only while Settings → Money allows it (closed for now). */
export const recordWithdrawal = adminAction(withdrawalSchema, async ({ partnerId, amount, occurredOn, note }, ctx) => {
  if (!(await getSetting("money")).withdrawals) throw new UserError("money.errors.withdrawalsClosed")
  const id = await db.transaction(async (tx) => {
    const id = await postWithdrawal(tx, { partnerId, amount, occurredOn, description: note, createdBy: ctx.admin.id })
    await ctx.audit(
      { action: "money.withdrawal", entity: "ledger_transaction", entityId: id, data: { partnerId, amount, occurredOn, note } },
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
