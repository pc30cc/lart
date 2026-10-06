import "server-only"
import { and, eq, inArray, or } from "drizzle-orm"

import { db, type Tx } from "@/db"
import { courses, media } from "@/db/schema"
import { errorForLog, UserError } from "@/lib/errors"
import { getStorage, type Zone } from "@/lib/storage"

export type MediaInput = {
  path: string
  kind: "sample" | "gallery_photo" | "gallery_video"
  originalPath?: string | null
  width?: number
  height?: number
}
export type MediaFile = { path: string; zone: Zone }

const groups = { sample: ["sample"], gallery: ["gallery_photo", "gallery_video"] } as const

/**
 * Make the media rows of one group (sample photos, or the gallery) of a
 * workshop match `items`, in that order: new paths are inserted, missing ones
 * deleted, the rest re-sorted. Paths already used elsewhere are refused.
 * Returns the files of deleted rows: remove them from storage after the commit.
 */
export async function syncMedia(tx: Tx, courseId: string, group: keyof typeof groups, items: MediaInput[]) {
  const existing = await tx
    .select({ id: media.id, path: media.path, originalPath: media.originalPath, sort: media.sort })
    .from(media)
    .where(and(eq(media.courseId, courseId), inArray(media.kind, [...groups[group]])))
  const known = new Map(existing.map((row) => [row.path, row]))
  const unique = items.filter((item, i) => items.findIndex((other) => other.path === item.path) === i)
  const fresh = unique.filter((item) => !known.has(item.path))

  if (fresh.length) {
    const paths = fresh.flatMap((f) => [f.path, ...(f.originalPath ? [f.originalPath] : [])])
    const [taken] = await tx
      .select({ id: media.id })
      .from(media)
      .where(or(inArray(media.path, paths), inArray(media.originalPath, paths)))
      .limit(1)
    if (taken) throw new UserError("workshops.errors.mediaInUse")
  }

  const keep = new Set(unique.map((item) => item.path))
  const removed = existing.filter((row) => !keep.has(row.path))
  if (removed.length) await tx.delete(media).where(inArray(media.id, removed.map((r) => r.id)))

  let reordered = 0
  for (const [sort, item] of unique.entries()) {
    const row = known.get(item.path)
    if (row && row.sort !== sort) {
      await tx.update(media).set({ sort }).where(eq(media.id, row.id))
      reordered++
    }
  }
  if (fresh.length) {
    await tx.insert(media).values(
      fresh.map((item) => ({
        courseId,
        kind: item.kind,
        path: item.path,
        // Only a new row takes an original; an existing row's original never changes.
        originalPath: item.originalPath ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
        sort: unique.indexOf(item),
      })),
    )
  }

  return {
    added: fresh.length,
    reordered,
    removed: removed.flatMap((r): MediaFile[] => [
      { path: r.path, zone: "public" },
      ...(r.originalPath ? [{ path: r.originalPath, zone: "private" as const }] : []),
    ]),
  }
}

/** Delete files from storage that no workshop refers to any more. Never throws (logged). */
export async function removeFiles(files: MediaFile[]): Promise<void> {
  if (!files.length) return
  try {
    const storage = await getStorage()
    for (const file of files) {
      const [inMedia] = await db
        .select({ id: media.id })
        .from(media)
        .where(or(eq(media.path, file.path), eq(media.originalPath, file.path)))
        .limit(1)
      const [asCover] = await db.select({ id: courses.id }).from(courses).where(eq(courses.coverPath, file.path)).limit(1)
      if (inMedia || asCover) continue
      await storage.remove(file.path, file.zone).catch((err) => console.error("[workshops] could not remove", file.path, errorForLog(err)))
    }
  } catch (err) {
    console.error("[workshops] file clean-up failed", errorForLog(err))
  }
}
