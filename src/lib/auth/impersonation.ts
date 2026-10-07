import "server-only"

import { db, type Db, type Tx } from "@/db"
import { audit } from "@/lib/audit"
import { currentSession, deleteImpersonationsBy, endSession, type ImpersonableKind } from "./session"

/**
 * Ending "viewing as someone" (a super admin's one-hour session as an
 * instructor or member, started by `startImpersonation`). Kept apart from
 * `./instructor` and `./member`, which tests mock wholesale.
 */

/** Why a viewing session ended (audit `<kind>.impersonate_end`, `data.reason`). */
export type EndReason = "end" | "logout" | "admin_logout" | "replaced"

/** The admin page of the person (where "End" goes back to). */
export const adminPersonPath = (kind: ImpersonableKind, id: string) =>
  kind === "instructor" ? `/admin/instructors/${id}` : `/admin/students/${id}`

/** Audit `<kind>.impersonate_end` as the admin who was viewing. Pass `tx` inside a transaction. */
export async function auditImpersonationEnd(
  kind: ImpersonableKind,
  subjectId: string,
  adminId: string,
  reason: EndReason,
  tx: Db | Tx = db,
) {
  await audit({ adminId, action: `${kind}.impersonate_end`, entity: kind, entityId: subjectId, data: { reason } }, tx)
}

/**
 * End this browser's viewing session of `kind`, if it is one. It is
 * authenticated by that session itself, so it works without the admin's
 * cookie. A person's own session is never touched (`own`).
 */
export async function endImpersonation(
  kind: ImpersonableKind,
  reason: EndReason,
): Promise<{ status: "ended"; subjectId: string; adminId: string } | { status: "own" } | { status: "none" }> {
  const session = await currentSession(kind)
  if (!session) return { status: "none" }
  if (!session.impersonatedBy) return { status: "own" }
  await endSession(kind)
  await auditImpersonationEnd(kind, session.subjectId, session.impersonatedBy.id, reason)
  return { status: "ended", subjectId: session.subjectId, adminId: session.impersonatedBy.id }
}

/** The admin signs out: end every session they opened as someone else, in every browser. Returns how many. */
export async function endImpersonationsBy(adminId: string, reason: EndReason = "admin_logout"): Promise<number> {
  const rows = await deleteImpersonationsBy(adminId)
  for (const row of rows) {
    if (row.kind === "admin") continue // impossible (database CHECK)
    await auditImpersonationEnd(row.kind, row.subjectId, adminId, reason)
  }
  return rows.length
}
