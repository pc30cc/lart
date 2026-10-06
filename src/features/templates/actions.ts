"use server"

import { and, count, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db, type Tx } from "@/db"
import { contracts, courses, registrations, templates, type Locale } from "@/db/schema"
import { adminAction, UserError } from "@/lib/action"
import { changes } from "@/lib/audit"
import { PG, pgError } from "@/lib/errors"
import { unknownPlaceholders, type TemplateKind } from "./placeholders"
import { templateIdSchema, templateSchema, templateUpdateSchema } from "./schema"

const LOCALES: Locale[] = ["fa", "tr", "en"]

function friendly(err: unknown): never {
  if (pgError(err)?.code === PG.foreignKeyViolation) throw new UserError("templates.errors.inUse")
  throw err
}

function revalidate() {
  revalidatePath("/[locale]/admin/templates", "layout")
}

/**
 * Serialize everything that touches the default of a kind (create, set
 * default, delete) for the rest of the transaction, so "exactly one default"
 * holds without races. The partial unique index is the final guard.
 */
async function lockKind(tx: Tx, kind: TemplateKind) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`templates:${kind}`}))`)
}

/** Kind of a template (it never changes), or a friendly "not found". */
async function kindOf(tx: Tx, id: string): Promise<TemplateKind> {
  const [row] = await tx.select({ kind: templates.kind }).from(templates).where(eq(templates.id, id))
  if (!row) throw new UserError("templates.errors.notFound")
  return row.kind
}

/** A new template. The first one of its kind becomes the default. */
export const createTemplate = adminAction(templateSchema, async (input, ctx) => {
  const id = await db.transaction(async (tx) => {
    await lockKind(tx, input.kind)
    const [current] = await tx
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.kind, input.kind), eq(templates.isDefault, true)))
    const [row] = await tx
      .insert(templates)
      .values({ ...input, isDefault: !current })
      .returning({ id: templates.id, isDefault: templates.isDefault })
    // The full text is kept in the audit log: it is the version history of the template.
    await ctx.audit({ action: "template.create", entity: "template", entityId: row.id, data: { ...input, isDefault: row.isDefault } }, tx)
    return row.id
  })
  revalidate()
  return { id }
})

/**
 * Change the name or text. Signed contracts keep the exact text that was
 * signed; registrations keep the fingerprint of the terms they accepted. The
 * previous text goes to the audit log.
 */
export const updateTemplate = adminAction(templateUpdateSchema, async ({ id, name, body }, ctx) => {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ kind: templates.kind, name: templates.name, body: templates.body })
      .from(templates)
      .where(eq(templates.id, id))
      .for("update")
    if (!before) throw new UserError("templates.errors.notFound")
    // The placeholders allowed depend on the stored kind, not on what the browser sent.
    const wrong = LOCALES.find((l) => body[l] && unknownPlaceholders(body[l], before.kind).length > 0)
    if (wrong) throw new UserError("templates.errors.unknownPlaceholder", { field: `body.${wrong}` })

    const diff = changes({ name: before.name, body: before.body }, { name, body })
    if (Object.keys(diff).length === 0) return
    await tx.update(templates).set({ name, body, updatedAt: sql`now()` }).where(eq(templates.id, id))
    await ctx.audit({ action: "template.update", entity: "template", entityId: id, data: { kind: before.kind, ...diff } }, tx)
  })
  revalidate()
  return { id }
})

/** Make this template the default of its kind; the previous default stops being one, atomically. */
export const setDefaultTemplate = adminAction(templateIdSchema, async ({ id }, ctx) => {
  await db.transaction(async (tx) => {
    const kind = await kindOf(tx, id)
    await lockKind(tx, kind)
    const [target] = await tx
      .select({ name: templates.name, isDefault: templates.isDefault })
      .from(templates)
      .where(eq(templates.id, id))
      .for("update")
    if (!target) throw new UserError("templates.errors.notFound")
    if (target.isDefault) return
    // Two statements, in this order: the unique index is checked row by row.
    const previous = await tx
      .update(templates)
      .set({ isDefault: false })
      .where(and(eq(templates.kind, kind), eq(templates.isDefault, true)))
      .returning({ id: templates.id })
    await tx.update(templates).set({ isDefault: true }).where(eq(templates.id, id))
    await ctx.audit(
      {
        action: "template.set_default",
        entity: "template",
        entityId: id,
        data: { kind, name: target.name, previousDefault: previous[0]?.id ?? null },
      },
      tx,
    )
  })
  revalidate()
  return { id }
})

/** Delete a template that is not the default and that nothing refers to. */
export const deleteTemplate = adminAction(templateIdSchema, async ({ id }, ctx) => {
  await db
    .transaction(async (tx) => {
      const kind = await kindOf(tx, id)
      await lockKind(tx, kind)
      // Row lock: a workshop, contract or registration added meanwhile waits, then fails its foreign key.
      const [row] = await tx
        .select({ name: templates.name, isDefault: templates.isDefault })
        .from(templates)
        .where(eq(templates.id, id))
        .for("update")
      if (!row) throw new UserError("templates.errors.notFound")
      if (row.isDefault) throw new UserError("templates.errors.deleteDefault")
      // One connection runs one query at a time: count one after the other.
      for (const [table, column] of [
        [courses, courses.termsTemplateId],
        [contracts, contracts.templateId],
        [registrations, registrations.termsTemplateId],
      ] as const) {
        const [{ n }] = await tx.select({ n: count() }).from(table).where(eq(column, id))
        if (n > 0) throw new UserError("templates.errors.inUse")
      }
      await tx.delete(templates).where(eq(templates.id, id))
      await ctx.audit({ action: "template.delete", entity: "template", entityId: id, data: { kind, name: row.name } }, tx)
    })
    .catch(friendly)
  revalidate()
  return { id }
})
