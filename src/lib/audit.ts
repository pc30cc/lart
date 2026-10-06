import "server-only"
import { headers } from "next/headers"

import { db, type Tx } from "@/db"
import { auditLog } from "@/db/schema"
import { clientIp } from "@/lib/auth/request"

/**
 * Audit trail of admin actions ("who did what"). Every super-admin mutation
 * writes one entry, inside the same transaction as the change when there is one.
 *
 * - `action`: "<entity>.<verb>", e.g. "category.create", "auth.login".
 * - `data`: what changed; never secrets or decrypted private data.
 */
export type AuditEntry = {
  adminId: string | null
  action: string
  entity: string
  entityId?: string | null
  data?: Record<string, unknown> | null
}

export async function audit(entry: AuditEntry, tx: Tx | typeof db = db): Promise<void> {
  await tx.insert(auditLog).values({
    adminId: entry.adminId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    data: entry.data ?? null,
    ip: await requestIp(),
  })
}

async function requestIp(): Promise<string | null> {
  try {
    return clientIp(await headers())
  } catch {
    return null // outside a request (scripts, tests)
  }
}

/** Only the fields that changed, as { field: { from, to } }. Handy as audit `data` for updates. */
export function changes<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of Object.keys(after) as (keyof T & string)[]) {
    if (stable(before[key]) !== stable(after[key])) out[key] = { from: before[key], to: after[key] }
  }
  return out
}

/** JSON with sorted object keys (jsonb from the database does not keep key order). */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}
