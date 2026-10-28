"use server"

import { and, eq, sum } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db, type Tx } from "@/db"
import { admins, expenseFiles, ledgerLines } from "@/db/schema"
import { adminAction, UserError } from "@/lib/action"
import { isMaintenance, latestWorkshop } from "@/lib/maintenance"
import { getSetting } from "@/lib/settings"
import { exists, mediaContentType } from "@/lib/storage"
import { activePartners, closeCourse } from "./closing"
import {
  postAdvance,
  postExpense,
  postInstructorPayment,
  postJointContribution,
  postWithdrawal,
  recordDiscrepancy,
  reverseTransaction,
  startEdit,
} from "./ledger"
import {
  advanceSchema,
  closeSchema,
  contributionSchema,
  discrepancySchema,
  editAdvanceSchema,
  editContributionSchema,
  editExpenseSchema,
  editInstructorPaymentSchema,
  expenseSchema,
  instructorPaymentSchema,
  reverseSchema,
  withdrawalSchema,
  type ExpenseFile,
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

/** Only files that were really uploaded (a form left open may hold one a failed save never kept). */
async function assertUploaded(files: ExpenseFile[]) {
  const stored = await Promise.all(files.map((f) => exists(f.path)))
  if (stored.includes(false)) throw new UserError("money.errors.fileGone", { field: "files" })
}

/** Keep the files (receipts, item photos) with a ledger entry. */
async function keepFiles(tx: Tx, transactionId: string, files: ExpenseFile[], adminId: string) {
  if (!files.length) return
  await tx.insert(expenseFiles).values(
    files.map((f) => ({
      transactionId,
      role: f.role,
      path: f.path,
      contentType: mediaContentType(f.path) ?? "application/octet-stream",
      createdBy: adminId,
    })),
  )
}

/** An expense of a workshop (`courseId`) or of the business, paid from the wallet or out of the advance; recorded by the spender. */
export const recordExpense = adminAction(expenseSchema, async ({ courseId, category, amount, occurredOn, source, furnishing, files }, ctx) => {
  // Maintenance (lib/maintenance.ts): only an expense of the latest workshop.
  if (await isMaintenance()) {
    const latest = await latestWorkshop()
    if (!courseId || courseId !== latest?.id) throw new UserError("common.errors.maintenanceExpenseOnly")
  }
  await assertSpender(ctx.admin.id)
  await assertUploaded(files)
  const id = await db.transaction(async (tx) => {
    const id = await postExpense(tx, {
      courseId,
      amount,
      occurredOn,
      description: category,
      source,
      furnishing,
      createdBy: ctx.admin.id,
    })
    await keepFiles(tx, id, files, ctx.admin.id)
    await ctx.audit(
      {
        action: "money.expense",
        entity: "ledger_transaction",
        entityId: id,
        data: { courseId, category, amount, occurredOn, paidFrom: source, furnishing, files: files.map((f) => f.path) },
      },
      tx,
    )
    return id
  })
  revalidate()
  return { id }
}, { duringMaintenance: true })

/** An advance paid to a workshop's instructor from the wallet (by the spender), or returned by them to it. */
export const recordAdvance = adminAction(advanceSchema, async ({ courseId, direction, amount, occurredOn, note, files }, ctx) => {
  if (direction === "paid") await assertSpender(ctx.admin.id)
  await assertUploaded(files)
  const id = await db.transaction(async (tx) => {
    const id = await postAdvance(tx, {
      courseId,
      direction,
      amount,
      occurredOn,
      description: note,
      createdBy: ctx.admin.id,
    })
    await keepFiles(tx, id, files, ctx.admin.id)
    await ctx.audit(
      {
        action: `money.advance_${direction}`,
        entity: "ledger_transaction",
        entityId: id,
        data: { courseId, amount, occurredOn, note, files: files.map((f) => f.path) },
      },
      tx,
    )
    return id
  })
  revalidate()
  return { id }
})

/** Pay the instructor what a closed workshop still owes them (or part of it), from the wallet; by the spender. */
export const payInstructor = adminAction(instructorPaymentSchema, async ({ courseId, amount, occurredOn, note, files }, ctx) => {
  await assertSpender(ctx.admin.id)
  await assertUploaded(files)
  const id = await db.transaction(async (tx) => {
    const id = await postInstructorPayment(tx, {
      courseId,
      amount,
      occurredOn,
      description: note,
      createdBy: ctx.admin.id,
    })
    await keepFiles(tx, id, files, ctx.admin.id)
    await ctx.audit(
      {
        action: "money.instructor_payment",
        entity: "ledger_transaction",
        entityId: id,
        data: { courseId, amount, occurredOn, note, files: files.map((f) => f.path) },
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

/**
 * Correct a mistake: post the mirror image of a transaction. When the mirror
 * takes money out of the wallet (undoing a contribution, an advance paid back,
 * …), it is a payment like any other: only the partner chosen in Settings →
 * Money may make it.
 */
export const reverseEntry = adminAction(reverseSchema, async ({ id }, ctx) => {
  const [wallet] = await db
    .select({ total: sum(ledgerLines.amount).mapWith(Number) })
    .from(ledgerLines)
    .where(and(eq(ledgerLines.transactionId, id), eq(ledgerLines.account, "wallet")))
  if ((wallet?.total ?? 0) > 0) await assertSpender(ctx.admin.id)
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
 * Record a discrepancy on an entry that concerns neither a participant nor an
 * instructor (an expense, a contribution, a withdrawal): it is brought to zero
 * by a reversal dated as it was, with the reason (`recordDiscrepancy`), and
 * stays in the list with the reason and who recorded it. Taking money out of
 * the wallet (a contribution's) is a payment: only the spender may.
 */
export const markDiscrepancy = adminAction(discrepancySchema, async ({ id, reason }, ctx) => {
  const [wallet] = await db
    .select({ total: sum(ledgerLines.amount).mapWith(Number) })
    .from(ledgerLines)
    .where(and(eq(ledgerLines.transactionId, id), eq(ledgerLines.account, "wallet")))
  if ((wallet?.total ?? 0) > 0) await assertSpender(ctx.admin.id)
  await db.transaction(async (tx) => {
    const entry = await recordDiscrepancy(tx, id, ctx.admin.id, reason)
    await ctx.audit(
      {
        action: "money.discrepancy",
        entity: "ledger_transaction",
        entityId: id,
        data: { reversalId: entry.reversalId, kind: entry.kind, courseId: entry.courseId, description: entry.description, occurredOn: entry.occurredOn, reason },
      },
      tx,
    )
  })
  revalidate()
  return { id }
})

// ─── Editing an entry ─────────────────────────────────────────────────────────
//
// Entries are never changed in place: an edit reverses the original (dated as
// it was, so its period nets to nothing) and records the corrected entry with
// `edit_of`, in one database transaction (`startEdit`). The same rules as
// recording it apply (who may pay from the wallet, the advance held, ...).

/** Edit an expense (furnishing too): subject, amount, date, paid from, and its files. The workshop stays. */
export const editExpense = adminAction(editExpenseSchema, async ({ id, category, amount, occurredOn, source, files }, ctx) => {
  await assertSpender(ctx.admin.id)
  await assertUploaded(files)
  const newId = await db.transaction(async (tx) => {
    const original = await startEdit(tx, id, ctx.admin.id)
    if (original.kind !== "expense") throw new UserError("money.errors.notEditable")
    const newId = await postExpense(tx, {
      courseId: original.courseId,
      amount,
      occurredOn,
      description: category,
      source: original.courseId ? source : "wallet",
      furnishing: original.furnishing,
      createdBy: ctx.admin.id,
      editOf: id,
    })
    // The files move to the corrected entry (a path is kept once): those the form still lists.
    await tx.delete(expenseFiles).where(eq(expenseFiles.transactionId, id))
    await keepFiles(tx, newId, files, ctx.admin.id)
    await ctx.audit(
      { action: "money.edit", entity: "ledger_transaction", entityId: id, data: { newId, kind: "expense", category, amount, occurredOn, paidFrom: source, files: files.map((f) => f.path) } },
      tx,
    )
    return newId
  })
  revalidate()
  return { id: newId }
})

/** Edit a contribution: the amount each partner put in, the date and the note (the same partners). */
export const editContribution = adminAction(editContributionSchema, async ({ id, amount, occurredOn, note }, ctx) => {
  const newId = await db.transaction(async (tx) => {
    const original = await startEdit(tx, id, ctx.admin.id)
    if (original.kind !== "capital_contribution" || original.partnerIds.length === 0) throw new UserError("money.errors.notEditable")
    const newId = await postJointContribution(tx, {
      partnerIds: original.partnerIds,
      amountEach: amount,
      occurredOn,
      description: note,
      createdBy: ctx.admin.id,
      editOf: id,
    })
    await ctx.audit(
      { action: "money.edit", entity: "ledger_transaction", entityId: id, data: { newId, kind: "capital_contribution", amountEach: amount, occurredOn, note } },
      tx,
    )
    return newId
  })
  revalidate()
  return { id: newId }
})

/** Edit an advance paid to (or returned by) the instructor: amount, date, note. */
export const editAdvance = adminAction(editAdvanceSchema, async ({ id, direction, amount, occurredOn, note }, ctx) => {
  await assertSpender(ctx.admin.id)
  const newId = await db.transaction(async (tx) => {
    const original = await startEdit(tx, id, ctx.admin.id)
    if (original.kind !== "instructor_advance" || !original.courseId) throw new UserError("money.errors.notEditable")
    const newId = await postAdvance(tx, { courseId: original.courseId, direction, amount, occurredOn, description: note, createdBy: ctx.admin.id, editOf: id })
    // Its receipts stay with it (the edit form does not change them).
    await tx.update(expenseFiles).set({ transactionId: newId }).where(eq(expenseFiles.transactionId, id))
    await ctx.audit(
      { action: "money.edit", entity: "ledger_transaction", entityId: id, data: { newId, kind: "instructor_advance", direction, amount, occurredOn, note } },
      tx,
    )
    return newId
  })
  revalidate()
  return { id: newId }
})

/** Edit a payment to the instructor: amount, date, note. */
export const editInstructorPayment = adminAction(editInstructorPaymentSchema, async ({ id, amount, occurredOn, note }, ctx) => {
  await assertSpender(ctx.admin.id)
  const newId = await db.transaction(async (tx) => {
    const original = await startEdit(tx, id, ctx.admin.id)
    if (original.kind !== "instructor_payment" || !original.courseId) throw new UserError("money.errors.notEditable")
    const newId = await postInstructorPayment(tx, { courseId: original.courseId, amount, occurredOn, description: note, createdBy: ctx.admin.id, editOf: id })
    // Its receipts stay with it (the edit form does not change them).
    await tx.update(expenseFiles).set({ transactionId: newId }).where(eq(expenseFiles.transactionId, id))
    await ctx.audit(
      { action: "money.edit", entity: "ledger_transaction", entityId: id, data: { newId, kind: "instructor_payment", amount, occurredOn, note } },
      tx,
    )
    return newId
  })
  revalidate()
  return { id: newId }
})

