import { z } from "zod"

import { backupFile } from "@/features/backup/backup"
import { audit } from "@/lib/audit"
import { requireAdminApi } from "@/lib/auth/admin"
import { getStorage } from "@/lib/storage"

/**
 * Download one backup (Settings → Backup): the locked ZIP, read from the
 * storage with its key and passed on, never through a public link. Super
 * admins only; every download is written to the audit log.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/backups/[id]">) {
  const session = await requireAdminApi(request)
  if (!session) return new Response(null, { status: 401 })

  const { id } = await ctx.params
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 })
  const backup = await backupFile(id)
  if (!backup) return new Response(null, { status: 404 })
  const file = await (await getStorage()).read(backup.path)
  if (!file) return new Response(null, { status: 404 })

  await audit({ adminId: session.admin.id, action: "backup.download", entity: "backup", entityId: id })
  return new Response(file.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${backup.name}"`,
      ...(file.size !== null ? { "Content-Length": String(file.size) } : {}),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
