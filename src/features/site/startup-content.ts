import "server-only"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { and, eq, sql } from "drizzle-orm"

import { db } from "@/db"
import { admins, auditLog } from "@/db/schema"
import { processImage } from "@/lib/images"
import { getStorage } from "@/lib/storage"
import { uploadPath } from "@/lib/storage/upload"

/**
 * One-time content the owner asked for, put in place by the running site
 * (a file in the repository can't be stored by a migration): partners'
 * portraits on the Our story page, from content/partners/. Each runs once per
 * file: it leaves an audit entry naming the file's SHA-256 and is skipped when
 * that entry exists (a new photo in the same file replaces the portrait).
 * Only the partner's row on the live database matches (id and name);
 * elsewhere nothing happens.
 */
export const PORTRAITS = [
  // 2026-10-11
  { id: "86a8d97e-293c-4563-85f6-6e2ad4b35911", name: "Lili Altin", file: "lili-altin.jpg", folder: "lili-altin" },
]
const ACTION = "content.portrait"

/** pg advisory lock key of this step ("LMRC"): two containers side by side while deploying never both run it. */
const LOCK = 0x4c4d5243

/** Place the portraits not placed yet; how many were placed. */
export async function placeStartupContent(root: string = process.cwd(), portraits = PORTRAITS) {
  return db.transaction(async (tx) => {
    const [{ locked }] = (await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${LOCK}) as locked`)).rows
    if (!locked) return 0
    let placed = 0
    for (const p of portraits) {
      const [partner] = await tx
        .select({ portraitPath: admins.portraitPath })
        .from(admins)
        .where(and(eq(admins.id, p.id), eq(admins.name, p.name)))
      if (!partner) continue
      const input = await readFile(path.join(root, "content/partners", p.file))
      const sha256 = createHash("sha256").update(input).digest("hex")
      const [done] = await tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.action, ACTION), eq(auditLog.entityId, p.id), sql`${auditLog.data}->>'sha256' = ${sha256}`))
        .limit(1)
      if (done) continue

      const image = await processImage(input, "partner_portrait")
      const portraitPath = uploadPath("partner_portrait", p.folder, image.ext)
      await (await getStorage()).put(portraitPath, image.data, image.contentType)
      await tx.update(admins).set({ portraitPath, aboutShown: true }).where(eq(admins.id, p.id))
      await tx.insert(auditLog).values({ adminId: null, action: ACTION, entity: "admin", entityId: p.id, data: { portraitPath, previous: partner.portraitPath, sha256 } })
      placed++
    }
    return placed
  })
}
