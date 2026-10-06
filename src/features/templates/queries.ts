import "server-only"
import { asc, desc, eq, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"

import { db } from "@/db"
import { contracts, courses, registrations, templates, type Locale, type LocalizedText } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"

/**
 * Columns qualified by hand: in a single-table select Drizzle prints bare
 * column names, which would resolve to the inner table of the subquery.
 */
const col = (table: PgTable, column: { name: string }) =>
  sql`${table}.${sql.identifier(column.name)}`
const templateId = col(templates, templates.id)

/** How many records point at the template (each blocks deleting it). */
const usage = {
  workshops: sql<number>`(select count(*)::int from ${courses} where ${col(courses, courses.termsTemplateId)} = ${templateId})`,
  contracts: sql<number>`(select count(*)::int from ${contracts} where ${col(contracts, contracts.templateId)} = ${templateId})`,
  signedContracts: sql<number>`(select count(*)::int from ${contracts} where ${col(contracts, contracts.templateId)} = ${templateId} and ${col(contracts, contracts.signedAt)} is not null)`,
  registrations: sql<number>`(select count(*)::int from ${registrations} where ${col(registrations, registrations.termsTemplateId)} = ${templateId})`,
}

export type TemplateUsage = { workshops: number; contracts: number; signedContracts: number; registrations: number }

export const isUsed = (u: TemplateUsage) => u.workshops + u.contracts + u.registrations > 0

const LOCALES: Locale[] = ["fa", "tr", "en"]
/** Which languages have text (the body itself stays on the server). */
const filledLocales = (body: LocalizedText) => LOCALES.filter((l) => body[l]?.trim())

/** All templates, default first, for the list page (no bodies). */
export async function listTemplates() {
  await requireAdmin()
  const rows = await db
    .select({
      id: templates.id,
      kind: templates.kind,
      name: templates.name,
      isDefault: templates.isDefault,
      body: templates.body,
      updatedAt: templates.updatedAt,
      ...usage,
    })
    .from(templates)
    .orderBy(asc(templates.kind), desc(templates.isDefault), asc(templates.name))
  return rows.map(({ body, workshops, contracts, signedContracts, registrations, ...row }) => ({
    ...row,
    languages: filledLocales(body),
    usage: { workshops, contracts, signedContracts, registrations },
  }))
}

export type TemplateRow = Awaited<ReturnType<typeof listTemplates>>[number]

/** One template with its text and usage, or null. */
export async function getTemplate(id: string) {
  await requireAdmin()
  const [row] = await db
    .select({
      id: templates.id,
      kind: templates.kind,
      name: templates.name,
      body: templates.body,
      isDefault: templates.isDefault,
      createdAt: templates.createdAt,
      updatedAt: templates.updatedAt,
      ...usage,
    })
    .from(templates)
    .where(eq(templates.id, id))
    .limit(1)
  if (!row) return null
  const { workshops, contracts, signedContracts, registrations, ...rest } = row
  return { ...rest, usage: { workshops, contracts, signedContracts, registrations } }
}

export type TemplateDetail = NonNullable<Awaited<ReturnType<typeof getTemplate>>>
