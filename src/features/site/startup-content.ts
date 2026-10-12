import "server-only"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { and, eq, sql } from "drizzle-orm"

import { db } from "@/db"
import { admins, auditLog, templates } from "@/db/schema"
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
 * elsewhere nothing happens. Also the owner's new default registration terms
 * (OLD_TERMS).
 */
export const PORTRAITS = [
  // 2026-10-11
  { id: "86a8d97e-293c-4563-85f6-6e2ad4b35911", name: "Lili Altin", file: "lili-altin.jpg", folder: "lili-altin" },
  { id: "a2cf679d-5fd0-4322-99b8-331495653593", name: "مریم کارامد", file: "maryam-karamad.jpg", folder: "maryam-karamad" },
]
const ACTION = "content.portrait"

/** pg advisory lock key of this step ("LMRC"): two containers side by side while deploying never both run it. */
const LOCK = 0x4c4d5243

/**
 * The default registration terms the owner rewrote (2026-10-12), by the
 * SHA-256 of each language's earlier bundled text: the default terms template
 * is given the new text (templates/defaults/terms.<l>.md) only while its text
 * is still exactly the earlier one, so a text edited in Templates is kept.
 */
const OLD_TERMS: Record<"fa" | "tr" | "en", string> = {
  fa: "bbf99000960f9e210b6e2acc9adfe34b71eb7e6cb0aa8b30f94c5b42d4ab8388",
  tr: "d889c3f2983ced7cbf65606bd2620b3222a766cf282f3c699ce600754e4619ba",
  en: "d1ad5a29c82f96fe967b1f3abca7f9ffc7a8d509d9fe7aad3b3df188e1ecd15f",
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex")

/** Place the portraits not placed yet (how many were placed) and the new default terms. */
export async function placeStartupContent(root: string = process.cwd(), portraits = PORTRAITS) {
  return db.transaction(async (tx) => {
    const [{ locked }] = (await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${LOCK}) as locked`)).rows
    if (!locked) return 0
    let placed = 0

    const [terms] = await tx
      .select({ id: templates.id, body: templates.body })
      .from(templates)
      .where(and(eq(templates.kind, "terms"), eq(templates.isDefault, true)))
    const body = terms?.body as Partial<Record<keyof typeof OLD_TERMS, string>> | undefined
    if (terms && body && (Object.keys(OLD_TERMS) as (keyof typeof OLD_TERMS)[]).every((l) => sha((body[l] ?? "").trim()) === OLD_TERMS[l])) {
      const read = async (l: string) => (await readFile(path.join(process.cwd(), "src/features/templates/defaults", `terms.${l}.md`), "utf8")).trim()
      const next = { fa: await read("fa"), tr: await read("tr"), en: await read("en") }
      await tx.update(templates).set({ body: next, updatedAt: new Date() }).where(eq(templates.id, terms.id))
      await tx.insert(auditLog).values({ adminId: null, action: "template.update", entity: "template", entityId: terms.id, data: { kind: "terms", body: { from: body, to: next }, startup: true } })
      console.info("[content] the default registration terms were updated")
    }

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
