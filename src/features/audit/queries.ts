import "server-only"
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm"
import { getTranslations } from "next-intl/server"

import { likePattern, type TableParams } from "@/components/admin/data-table/params"
import { db } from "@/db"
import { admins, auditLog } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { zonedToIso } from "@/lib/format"
import { auditDetail, auditSummary } from "./format"
import { nextDay, type DateRange } from "./range"

/** Sortable columns of the activity log. */
export const auditTable = { sort: ["at", "action", "entity"] as const }
type Sort = (typeof auditTable.sort)[number]
type Filter = "admin" | "entity"

/** Choices for the filters: every admin (also former ones) and every entity that appears in the log. */
export async function getAuditFilterOptions() {
  await requireAdmin()
  const [people, entities] = await Promise.all([
    db.select({ id: admins.id, name: admins.name }).from(admins).orderBy(asc(admins.name)),
    db.selectDistinct({ entity: auditLog.entity }).from(auditLog).orderBy(asc(auditLog.entity)),
  ])
  return { admins: people, entities: entities.map((row) => row.entity) }
}

/** Start of an Istanbul calendar day as an instant. */
const dayStart = (date: string) => new Date(zonedToIso(date, "00:00")!)

/** Text for matching a search against labels: lower case for the language, without the Persian half-space (ZWNJ). */
const fold = (text: string, locale: string) => text.replace(/\u200c/g, "").toLocaleLowerCase(locale)

/** `{ money: { reverse: "Transaction reversed" } }` → `[["money.reverse", "Transaction reversed"]]`. */
function flattenLabels(labels: unknown, prefix = ""): [code: string, label: string][] {
  if (typeof labels === "string") return prefix ? [[prefix, labels]] : []
  if (!labels || typeof labels !== "object") return []
  return Object.entries(labels).flatMap(([key, value]) => flattenLabels(value, prefix ? `${prefix}.${key}` : key))
}

/**
 * The codes whose translated label contains the search text, so people find
 * what they see in the table ("Transaction reversed" → "money.reverse").
 * `labels` is a message map such as `settings.audit.actions` or `.entities`.
 */
export function codesByLabel(query: string, labels: unknown, locale: string): string[] {
  const q = fold(query.trim(), locale)
  if (!q) return []
  return flattenLabels(labels)
    .filter(([, label]) => fold(label, locale).includes(q))
    .map(([code]) => code)
}

/** One page of the activity log: search, filters, date range (Istanbul days, inclusive), sort. */
export async function listAudit(params: TableParams<Sort, Filter>, range: DateRange, locale: string) {
  await requireAdmin()

  const conditions: (SQL | undefined)[] = []
  if (params.q) {
    const pattern = likePattern(params.q)
    const t = await getTranslations({ locale, namespace: "settings.audit" })
    const actions = codesByLabel(params.q, t.raw("actions"), locale)
    const entities = codesByLabel(params.q, t.raw("entities"), locale)
    conditions.push(
      or(
        ilike(auditLog.action, pattern),
        ilike(auditLog.entity, pattern),
        ilike(auditLog.entityId, pattern),
        ilike(auditLog.ip, pattern),
        ilike(admins.name, pattern),
        ilike(sql`${auditLog.data}::text`, pattern),
        // The labels shown in the "What" and "Record" columns, in the page's language.
        actions.length ? inArray(auditLog.action, actions) : undefined,
        entities.length ? inArray(auditLog.entity, entities) : undefined,
      ),
    )
  }
  if (params.filters.admin) conditions.push(eq(auditLog.adminId, params.filters.admin))
  if (params.filters.entity) conditions.push(eq(auditLog.entity, params.filters.entity))
  if (range.from) conditions.push(gte(auditLog.at, dayStart(range.from)))
  if (range.to) conditions.push(lt(auditLog.at, dayStart(nextDay(range.to))))
  const where = and(...conditions)

  const column = params.sort === "action" ? auditLog.action : params.sort === "entity" ? auditLog.entity : auditLog.at
  const direction = params.dir === "asc" ? asc : desc

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        action: auditLog.action,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        data: auditLog.data,
        ip: auditLog.ip,
        adminId: auditLog.adminId,
        adminName: admins.name,
      })
      .from(auditLog)
      .leftJoin(admins, eq(admins.id, auditLog.adminId))
      .where(where)
      .orderBy(direction(column), desc(auditLog.at), desc(auditLog.id))
      .limit(params.pageSize)
      .offset(params.offset),
    db.select({ total: count() }).from(auditLog).leftJoin(admins, eq(admins.id, auditLog.adminId)).where(where),
  ])

  // Only a summary and a size-limited copy of `data` go to the page.
  return {
    rows: rows.map(({ data, ...row }) => ({ ...row, summary: auditSummary(data, locale), detail: auditDetail(data) })),
    total,
  }
}

export type AuditRow = Awaited<ReturnType<typeof listAudit>>["rows"][number]
