"use server"

import { count, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { categories, courses } from "@/db/schema"
import { adminAction, UserError } from "@/lib/action"
import { changes } from "@/lib/audit"
import { PG, pgError } from "@/lib/errors"
import { categoryIdSchema, categorySchema, categoryUpdateSchema } from "./schema"

/** Turn database constraint errors into friendly messages. */
function friendly(err: unknown): never {
  const pg = pgError(err)
  if (pg?.code === PG.uniqueViolation) throw new UserError("categories.errors.slugTaken", { field: "slug" })
  if (pg?.code === PG.foreignKeyViolation) throw new UserError("categories.errors.inUseGeneric")
  throw err
}

/**
 * Fresh list after a change, in every language. (The forms navigate back to
 * the list; on a page that stays put, call `refresh()` from next/cache instead.)
 */
function revalidate() {
  revalidatePath("/[locale]/admin/categories", "page")
}

export const createCategory = adminAction(categorySchema, async (input, ctx) => {
  const id = await db
    .transaction(async (tx) => {
      const [row] = await tx.insert(categories).values(input).returning({ id: categories.id })
      await ctx.audit({ action: "category.create", entity: "category", entityId: row.id, data: input }, tx)
      return row.id
    })
    .catch(friendly)
  revalidate()
  return { id }
})

export const updateCategory = adminAction(categoryUpdateSchema, async ({ id, ...input }, ctx) => {
  await db
    .transaction(async (tx) => {
      const [before] = await tx
        .select({ name: categories.name, slug: categories.slug, sort: categories.sort })
        .from(categories)
        .where(eq(categories.id, id))
        .for("update")
      if (!before) throw new UserError("categories.errors.notFound")
      const diff = changes(before, input)
      if (Object.keys(diff).length === 0) return
      await tx.update(categories).set(input).where(eq(categories.id, id))
      await ctx.audit({ action: "category.update", entity: "category", entityId: id, data: diff }, tx)
    })
    .catch(friendly)
  revalidate()
  return { id }
})

/** Delete only when no workshop uses the category (the foreign key enforces it too). */
export const deleteCategory = adminAction(categoryIdSchema, async ({ id }, ctx) => {
  await db
    .transaction(async (tx) => {
      // Lock the row: a workshop added meanwhile waits, then fails its foreign key.
      const [row] = await tx
        .select({ slug: categories.slug, name: categories.name })
        .from(categories)
        .where(eq(categories.id, id))
        .for("update")
      if (!row) throw new UserError("categories.errors.notFound")
      const [{ used }] = await tx.select({ used: count() }).from(courses).where(eq(courses.categoryId, id))
      if (used > 0) throw new UserError("categories.errors.inUse", { values: { count: used } })
      await tx.delete(categories).where(eq(categories.id, id))
      await ctx.audit({ action: "category.delete", entity: "category", entityId: id, data: row }, tx)
    })
    .catch(friendly)
  revalidate()
  return { id }
})
