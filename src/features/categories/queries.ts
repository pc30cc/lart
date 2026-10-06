import "server-only"
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm"

import { likePattern, type TableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { categories, courses } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import type { categoryTable } from "./schema"

type Sort = (typeof categoryTable.sort)[number]
type Filter = keyof typeof categoryTable.filters

/**
 * Number of workshops in the category (any status). Columns are qualified by
 * hand: in a single-table select Drizzle prints bare column names, which would
 * resolve to `courses` inside the subquery.
 */
const col = (table: typeof courses | typeof categories, column: { name: string }) =>
  sql`${table}.${sql.identifier(column.name)}`
const workshops = sql<number>`(select count(*)::int from ${courses} where ${col(courses, courses.categoryId)} = ${col(categories, categories.id)})`

/** Categories for the admin list: search, filter, sort, one page. */
export async function listCategories(params: TableParams<Sort, Filter>, locale: string) {
  await requireAdmin()

  const conditions: (SQL | undefined)[] = []
  if (params.q) {
    const pattern = likePattern(params.q)
    conditions.push(
      or(
        ilike(sql`${categories.name}->>'fa'`, pattern),
        ilike(sql`${categories.name}->>'tr'`, pattern),
        ilike(sql`${categories.name}->>'en'`, pattern),
        ilike(categories.slug, pattern),
      ),
    )
  }
  if (params.filters.usage === "used") conditions.push(sql`${workshops} > 0`)
  if (params.filters.usage === "unused") conditions.push(sql`${workshops} = 0`)
  const where = and(...conditions)

  const lang = locale === "fa" || locale === "en" ? locale : "tr"
  const name = sql`lower(coalesce(nullif(${categories.name}->>${lang}, ''), ${categories.name}->>'tr', ''))`
  const column = params.sort === "name" ? name : params.sort === "workshops" ? workshops : categories.sort
  const direction = params.dir === "desc" ? desc : asc

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ id: categories.id, slug: categories.slug, name: categories.name, sort: categories.sort, workshops })
      .from(categories)
      .where(where)
      .orderBy(direction(column), asc(categories.sort), asc(categories.slug))
      .limit(params.pageSize)
      .offset(params.offset),
    db.select({ total: count() }).from(categories).where(where),
  ])
  return { rows, total }
}

export type CategoryRow = Awaited<ReturnType<typeof listCategories>>["rows"][number]

/** One category with its workshop count, or null. */
export async function getCategory(id: string) {
  await requireAdmin()
  const [row] = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name, sort: categories.sort, workshops })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1)
  return row ?? null
}
