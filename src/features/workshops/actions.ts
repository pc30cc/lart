"use server"

import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { refresh, revalidatePath } from "next/cache"
import { after } from "next/server"
import { getLocale } from "next-intl/server"

import { db, type Tx } from "@/db"
import { contracts, courses, instructors, members, registrations, templates } from "@/db/schema"
import { sendContractReady } from "@/features/contracts/notify"
import { courseBalances } from "@/features/money/ledger"
import { memberLocale } from "@/features/registrations/admin/notify"
import { adminAction, UserError } from "@/lib/action"
import { changes } from "@/lib/audit"
import { errorForLog, PG, pgError } from "@/lib/errors"
import { localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { getSetting } from "@/lib/settings"
import { sendEmail } from "@/lib/email"
import { removeFiles, syncMedia, type MediaFile } from "./media"
import {
  changedContractFields,
  contractLocked,
  courseValues,
  feeValues,
  gallerySchema,
  isCancelled,
  raiseFinalSchema,
  workshopIdSchema,
  workshopSchema,
  workshopUpdateSchema,
} from "./schema"

/** Turn database constraint errors into friendly messages. */
function friendly(err: unknown): never {
  const pg = pgError(err)
  if (pg?.code === PG.uniqueViolation && pg.constraint?.includes("slug")) {
    throw new UserError("workshops.errors.slugTaken", { field: "slug" })
  }
  if (pg?.code === PG.foreignKeyViolation) throw new UserError("workshops.errors.choiceGone")
  throw err
}

function revalidate() {
  revalidatePath("/[locale]/admin/workshops", "page")
}

/** The default contract template (fixed clauses); a workshop can't be created without one. */
async function defaultContractTemplate(tx: Tx): Promise<string> {
  const [row] = await tx
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.kind, "contract"), eq(templates.isDefault, true)))
    .limit(1)
  if (!row) throw new UserError("workshops.errors.noContractTemplate")
  return row.id
}

/** The chosen instructor must be active and approved (unless unchanged) and the terms template must be a terms template. */
async function checkChoices(
  tx: Tx,
  values: { instructorId: string; termsTemplateId: string | null },
  before?: { instructorId: string; termsTemplateId: string | null },
) {
  if (values.instructorId !== before?.instructorId) {
    const [person] = await tx
      .select({ active: instructors.active, approvedAt: instructors.approvedAt })
      .from(instructors)
      .where(eq(instructors.id, values.instructorId))
    if (!person?.active || !person.approvedAt) throw new UserError("workshops.errors.instructorUnavailable", { field: "instructorId" })
  }
  if (values.termsTemplateId && values.termsTemplateId !== before?.termsTemplateId) {
    const [terms] = await tx
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.id, values.termsTemplateId), eq(templates.kind, "terms")))
    if (!terms) throw new UserError("workshops.errors.choiceGone", { field: "termsTemplateId" })
  }
}

const activeRegistrations = (tx: Tx, courseId: string) =>
  tx
    .select({ n: count() })
    .from(registrations)
    .where(and(eq(registrations.courseId, courseId), inArray(registrations.status, ["pending", "confirmed"])))
    .then(([row]) => row.n)

/** The contract email never blocks saving: the result only tells the admin whether it went out. */
async function emailContract(contractId: string): Promise<boolean> {
  return sendContractReady(contractId).catch((err) => {
    console.error("[workshops] contract_ready email failed", errorForLog(err))
    return false
  })
}

/**
 * Create a workshop and its contract (version 1, "sent", default contract
 * template) in one transaction, then email the contract to the instructor.
 */
export const createWorkshop = adminAction(workshopSchema, async (input, ctx) => {
  const values = courseValues(input)
  const fee = feeValues(input)
  const { id, contractId } = await db
    .transaction(async (tx) => {
      await checkChoices(tx, values)
      const templateId = await defaultContractTemplate(tx)
      const [course] = await tx
        .insert(courses)
        .values({ ...values, status: "awaiting_signature", createdBy: ctx.admin.id })
        .returning({ id: courses.id })
      await syncMedia(
        tx,
        course.id,
        "sample",
        input.samples.map((s) => ({ ...s, kind: "sample" as const })),
      )
      const [contract] = await tx
        .insert(contracts)
        .values({ courseId: course.id, version: 1, instructorId: values.instructorId, templateId, status: "sent", ...fee })
        .returning({ id: contracts.id })
      await ctx.audit(
        {
          action: "workshop.create",
          entity: "workshop",
          entityId: course.id,
          data: {
            slug: values.slug,
            title: values.title,
            startsAt: values.startsAt,
            instructorId: values.instructorId,
            price: values.price,
            ...(values.paymentUrl ? { paymentUrl: values.paymentUrl } : {}),
            contract: { id: contract.id, version: 1, ...fee },
          },
        },
        tx,
      )
      return { id: course.id, contractId: contract.id }
    })
    .catch(friendly)

  const emailSent = await emailContract(contractId)
  revalidate()
  return { id, contractVersion: 1 as number | null, emailSent: emailSent as boolean | null }
})

/**
 * Edit a workshop. A change to a field that appears in the contract voids the
 * live contract and sends a new version; the workshop waits for the signature
 * again. A confirmed workshop keeps its go decision and final number (signing
 * confirms it again), and its contract can't change once it has started (see
 * `contractLocked`). The price is locked once people have registered.
 * The instructor can't change while an advance is still held: the ledger keeps
 * it per workshop, not per instructor, so the new instructor would see it (and
 * have it set off against their fee) as their own. It is recorded as returned
 * (or reversed) on the finances page first. A new start time clears the
 * day-before reminders already sent, so everyone is reminded of the new date.
 */
export const updateWorkshop = adminAction(workshopUpdateSchema, async ({ id, ...input }, ctx) => {
  const values = courseValues(input)
  const fee = feeValues(input)

  const outcome = await db
    .transaction(async (tx) => {
      const [before] = await tx.select().from(courses).where(eq(courses.id, id)).for("update")
      if (!before) throw new UserError("workshops.errors.notFound")
      const [current] = await tx
        .select()
        .from(contracts)
        .where(eq(contracts.courseId, id))
        .orderBy(sql`${contracts.status} = 'void'`, desc(contracts.version))
        .limit(1)
        .for("update")

      const courseDiff = changes(before, values)
      const feeDiff = changes((current ?? {}) as Partial<typeof fee>, fee)
      const contractDiff = changedContractFields(courseDiff)
      const contractChanged = contractDiff.length > 0 || Object.keys(feeDiff).length > 0
      if (contractChanged && contractLocked(before)) throw new UserError("workshops.errors.contractLocked")

      const registered = await activeRegistrations(tx, id)
      if ("price" in courseDiff && registered > 0) throw new UserError("workshops.errors.priceLocked", { field: "price" })
      if (values.maxCapacity < registered) {
        throw new UserError("workshops.errors.capacityBelowRegistrations", {
          field: "maxCapacity",
          values: { count: registered },
        })
      }
      // The workshop row is held FOR UPDATE, so no advance can be posted meanwhile (`lockCourse`).
      if (values.instructorId !== before.instructorId) {
        const { advance } = await courseBalances(tx, id)
        if (advance !== 0) {
          throw new UserError("workshops.errors.advanceHeld", {
            field: "instructorId",
            values: { amount: formatLira(advance, await getLocale()) },
          })
        }
      }
      await checkChoices(tx, values, before)

      const now = new Date()
      if (Object.keys(courseDiff).length || contractChanged) {
        await tx
          .update(courses)
          .set({
            ...values,
            ...(contractChanged ? { status: "awaiting_signature" as const } : {}),
            ...("decisionAt" in courseDiff ? { decisionNotifiedAt: null } : {}),
            updatedAt: now,
          })
          .where(eq(courses.id, id))
      }
      // A reminder already sent was for the old date (registrations after the workshop: lock order).
      const remindersReset =
        "startsAt" in courseDiff
          ? (
              await tx
                .update(registrations)
                .set({ reminderSentAt: null })
                .where(
                  and(
                    eq(registrations.courseId, id),
                    inArray(registrations.status, ["pending", "confirmed"]),
                    isNotNull(registrations.reminderSentAt),
                  ),
                )
                .returning({ id: registrations.id })
            ).length
          : 0
      const samples = await syncMedia(
        tx,
        id,
        "sample",
        input.samples.map((s) => ({ ...s, kind: "sample" as const })),
      )

      let reissued: { id: string; version: number; voided: number | null } | null = null
      if (contractChanged) {
        const live = current && current.status !== "void" ? current : null
        if (live) await tx.update(contracts).set({ status: "void", voidedAt: now }).where(eq(contracts.id, live.id))
        const templateId = await defaultContractTemplate(tx)
        const version = (current?.version ?? 0) + 1
        const [row] = await tx
          .insert(contracts)
          .values({ courseId: id, version, instructorId: values.instructorId, templateId, status: "sent", ...fee })
          .returning({ id: contracts.id })
        reissued = { id: row.id, version, voided: live?.version ?? null }
      }

      const data = {
        ...courseDiff,
        ...feeDiff,
        ...(samples.added || samples.removed.length || samples.reordered
          ? { samples: { added: samples.added, removed: samples.removed.filter((f) => f.zone === "public").length } }
          : {}),
        ...(reissued ? { contract: { voidedVersion: reissued.voided, newVersion: reissued.version } } : {}),
        ...(contractChanged && before.status !== "awaiting_signature" ? { status: { from: before.status, to: "awaiting_signature" } } : {}),
        ...(remindersReset ? { remindersReset } : {}),
      }
      if (Object.keys(data).length) {
        await ctx.audit({ action: "workshop.update", entity: "workshop", entityId: id, data }, tx)
      }

      const removed: MediaFile[] = [...samples.removed]
      if ("coverPath" in courseDiff && before.coverPath) removed.push({ path: before.coverPath, zone: "public" })
      return { reissued, removed }
    })
    .catch(friendly)

  await removeFiles(outcome.removed)
  const emailSent = outcome.reissued ? await emailContract(outcome.reissued.id) : null
  revalidate()
  return { id, contractVersion: outcome.reissued?.version ?? null, emailSent }
})

/**
 * Go decision: the workshop takes place; the number of participants is fixed
 * now. Everyone registered counts, paid or not yet (many pay in cash at the
 * workshop): the active registrations, read under the workshop's lock, so a
 * registration at the same moment is either counted or waits.
 * A decision that was missed can still be taken after the start: confirming
 * records that the workshop was held, so it can be closed with the fee from
 * its contract (cancelling would owe every payer a full refund instead).
 * From then on, registrations are capped at `final_participants` (`seatLimit`
 * in features/registrations/schema.ts): a cancelled place can be taken again,
 * but more people only after the instructor agreed and an admin raised the
 * number (`raiseFinalParticipants`).
 */
export const confirmWorkshop = adminAction(workshopIdSchema, async ({ id }, ctx) => {
  const finalParticipants = await db.transaction(async (tx) => {
    const [course] = await tx
      .select({ status: courses.status, minCapacity: courses.minCapacity })
      .from(courses)
      .where(eq(courses.id, id))
      .for("update")
    if (!course) throw new UserError("workshops.errors.notFound")
    if (course.status !== "published") throw new UserError("workshops.errors.cannotConfirm")
    const n = await activeRegistrations(tx, id)
    await tx
      .update(courses)
      .set({ status: "confirmed", finalParticipants: n, updatedAt: new Date() })
      .where(eq(courses.id, id))
    await ctx.audit(
      {
        action: "workshop.confirm",
        entity: "workshop",
        entityId: id,
        data: { finalParticipants: n, minimum: course.minCapacity },
      },
      tx,
    )
    return n
  })
  revalidate()
  refresh()
  return { id, finalParticipants }
})

/**
 * More places after the go decision: the instructor agreed (contract 5.2) to
 * teach more people than the number fixed then, so the admin raises
 * `final_participants`; registrations open again up to it, and a
 * per-participant fee is paid on it. Only for a confirmed workshop that has
 * not started; the workshop is locked FOR UPDATE (a registration at the same
 * moment waits); the new number must be higher than the current one and at
 * most the maximum capacity. Audited with the instructor's approval noted.
 */
export const raiseFinalParticipants = adminAction(raiseFinalSchema, async ({ id, finalParticipants: to }, ctx) => {
  await db.transaction(async (tx) => {
    const [course] = await tx
      .select({
        status: courses.status,
        cancelledAt: courses.cancelledAt,
        startsAt: courses.startsAt,
        finalParticipants: courses.finalParticipants,
        maxCapacity: courses.maxCapacity,
      })
      .from(courses)
      .where(eq(courses.id, id))
      .for("update")
    if (!course) throw new UserError("workshops.errors.notFound")
    if (course.status !== "confirmed" || course.cancelledAt || course.finalParticipants === null || course.startsAt <= new Date()) {
      throw new UserError("workshops.errors.cannotRaiseFinal")
    }
    const from = course.finalParticipants
    if (to <= from) throw new UserError("workshops.errors.finalNotHigher", { field: "finalParticipants", values: { count: from } })
    if (to > course.maxCapacity) {
      throw new UserError("workshops.errors.finalAboveMax", { field: "finalParticipants", values: { max: course.maxCapacity } })
    }
    await tx.update(courses).set({ finalParticipants: to, updatedAt: new Date() }).where(eq(courses.id, id))
    await ctx.audit(
      { action: "workshop.raiseFinal", entity: "workshop", entityId: id, data: { from, to, instructorApproved: true } },
      tx,
    )
  })
  revalidate()
  refresh()
  return { id, finalParticipants: to }
})

/**
 * No-go / cancel: the workshop and every open registration are cancelled.
 * Paid registrations are owed a full refund (refund_amount = amount): they
 * appear in Money → Refunds, where an admin marks each one as paid back (that
 * posts the refund to the ledger). Unpaid ones are cancelled with nothing
 * owed. Everyone registered gets a friendly email in their own language:
 * with the refund when they had paid, else that the workshop won't take
 * place (so nobody comes to the venue for nothing). An
 * unsigned contract is voided; a signed one stays as the record. The workshop
 * is locked first (FOR UPDATE), so a payment recorded at the same moment is
 * either refunded here or refused afterwards.
 */
export const cancelWorkshop = adminAction(workshopIdSchema, async ({ id }, ctx) => {
  const { title, refunds } = await db.transaction(async (tx) => {
    const [course] = await tx
      .select({ status: courses.status, title: courses.title })
      .from(courses)
      .where(eq(courses.id, id))
      .for("update")
    if (!course) throw new UserError("workshops.errors.notFound")
    if (course.status === "cancelled" || course.status === "closed") throw new UserError("workshops.errors.cannotCancel")

    const now = new Date()
    await tx.update(courses).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(courses.id, id))
    const voided = await tx
      .update(contracts)
      .set({ status: "void", voidedAt: now })
      .where(and(eq(contracts.courseId, id), eq(contracts.status, "sent")))
      .returning({ version: contracts.version })
    // SET expressions see the old row, so the CASE reads the status before the update.
    const cancelled = await tx
      .update(registrations)
      .set({
        status: "cancelled",
        cancelledAt: now,
        refundAmount: sql`case when ${registrations.status} = 'confirmed' then ${registrations.amount} else 0 end`,
      })
      .where(and(eq(registrations.courseId, id), inArray(registrations.status, ["pending", "confirmed"])))
      .returning({ id: registrations.id, memberId: registrations.memberId, refundAmount: registrations.refundAmount })

    const refundTotal = cancelled.reduce((sum, r) => sum + (r.refundAmount ?? 0), 0)
    await ctx.audit(
      {
        action: "workshop.cancel",
        entity: "workshop",
        entityId: id,
        data: {
          from: course.status,
          registrations: cancelled.length,
          refundTotal,
          ...(voided.length ? { voidedContractVersion: voided[0].version } : {}),
        },
      },
      tx,
    )
    return { title: course.title, refunds: cancelled }
  })

  // One email per member (a parent may have registered two children), paid or not, after the response.
  const perMember = new Map<string, number>()
  for (const r of refunds) perMember.set(r.memberId, (perMember.get(r.memberId) ?? 0) + (r.refundAmount ?? 0))
  if (perMember.size) after(() => emailCancellation(id, title, perMember))

  revalidate()
  refresh()
  return { id, cancelledRegistrations: refunds.length, emailed: perMember.size }
})

/** "The workshop is cancelled": "you get {refundAmount} back", or (nothing paid) "please don't come", in each member's own language. */
async function emailCancellation(courseId: string, title: Record<string, string | undefined>, refunds: Map<string, number>) {
  const fallback = await getSetting("defaultLocale")
  const people = await db
    .select({ id: members.id, name: members.name, email: members.email, locale: members.locale })
    .from(members)
    .where(inArray(members.id, [...refunds.keys()]))
  for (const person of people) {
    const locale = memberLocale(person.locale, fallback)
    const refund = refunds.get(person.id) ?? 0
    await sendEmail({
      to: person.email,
      template: "workshop_cancelled",
      locale,
      idempotencyKey: `workshop_cancelled:${courseId}:${person.id}`,
      props: {
        name: person.name,
        workshopTitle: localized(title, locale),
        ...(refund > 0 ? { refundAmount: formatLira(refund, locale) } : {}),
        workshopsUrl: `/${locale}/workshops`,
      },
    })
  }
}

/** Save the gallery of a closed (not cancelled) workshop: photos and videos in order (adds, removes, re-sorts). */
export const saveGallery = adminAction(gallerySchema, async ({ id, items }, ctx) => {
  const removed = await db.transaction(async (tx) => {
    const [course] = await tx
      .select({ status: courses.status, cancelledAt: courses.cancelledAt })
      .from(courses)
      .where(eq(courses.id, id))
      .for("update")
    if (!course) throw new UserError("workshops.errors.notFound")
    if (isCancelled(course)) throw new UserError("workshops.errors.galleryCancelled")
    if (course.status !== "closed") throw new UserError("workshops.errors.galleryClosedOnly")
    const result = await syncMedia(
      tx,
      id,
      "gallery",
      items.map((item) =>
        item.kind === "image"
          ? { ...item, kind: "gallery_photo" as const }
          : { path: item.path, kind: "gallery_video" as const },
      ),
    )
    const removedItems = result.removed.filter((f) => f.zone === "public").length
    if (result.added || removedItems || result.reordered) {
      await ctx.audit(
        {
          action: "workshop.gallery",
          entity: "workshop",
          entityId: id,
          data: { added: result.added, removed: removedItems, reordered: result.reordered, total: items.length },
        },
        tx,
      )
    }
    return result.removed
  })
  await removeFiles(removed)
  return { id, count: items.length }
})
