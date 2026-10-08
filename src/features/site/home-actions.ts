"use server"

import { refresh } from "next/cache"

import { db } from "@/db"
import { adminAction } from "@/lib/action"
import { changes } from "@/lib/audit"
import { errorForLog, UserError } from "@/lib/errors"
import { setSetting, type SettingValue } from "@/lib/settings"
import { exists, remove } from "@/lib/storage"
import { homeFileFields, homeFiles, homeFormSchema, isSiteImagePath, isSiteVideoPath } from "./home-schema"
import { readHome } from "./home-settings"

type Home = SettingValue<"home">

const sections = ["hero", "story", "crafts", "past", "steps", "footer"] as const

/**
 * The home page's content (Settings → Home page). Audited as one
 * `setting.update` entry with what changed per field ("hero.title": { from, to }).
 * Photos and the video no longer used are removed from storage after the
 * change is saved (a file that cannot be removed is only logged).
 *
 * The form sends the version of the saved page it was loaded with: when
 * another save came in between (another tab, another admin), it is refused
 * with a request to reload, since its photos may be files that save removed.
 * A photo or video the saved page does not use yet must still be in storage.
 * Returns the new version, which the form keeps for its next save.
 */
export const saveHomeSettings = adminAction(homeFormSchema, async ({ version, ...input }, ctx) => {
  const saved = await db.transaction(async (tx) => {
    // Read under a lock, so two saves at once never remove a file the other one keeps.
    const { home: current, version: currentVersion } = await readHome(tx, { lock: true })

    const diff = Object.fromEntries(
      sections.flatMap((section) =>
        Object.entries(changes(current[section] as Record<string, unknown>, input[section])).map(([field, change]) => [
          `${section}.${field}`,
          change,
        ]),
      ),
    )
    // Nothing to change: the page is up to date, whatever it was loaded with.
    if (Object.keys(diff).length === 0) return { before: null, version: currentVersion }
    if (version !== currentVersion) throw new UserError("homeEditor.errors.pageChanged")
    await assertStored(input, current)

    await setSetting("home", input, tx)
    await ctx.audit({ action: "setting.update", entity: "setting", entityId: "home", data: diff }, tx)
    return { before: current, version: (await readHome(tx)).version }
  })
  const { before } = saved
  if (!before) return { changed: false, version: saved.version }

  // Only files of the home page (site/…) are ever removed here.
  const kept = new Set(homeFiles(input))
  const unused = [...new Set(homeFiles(before))].filter((path) => !kept.has(path) && (isSiteImagePath(path) || isSiteVideoPath(path)))
  await Promise.all(
    unused.map((path) => remove(path).catch((err) => console.warn("[home settings] unused file not removed", errorForLog(err)))),
  )
  refresh()
  return { changed: true, version: saved.version }
})

/**
 * Refuses (on its field) a photo or video that the saved value does not use
 * yet and that is not in storage: storing it would show a broken photo.
 */
async function assertStored(input: Home, current: Home) {
  const known = new Set(homeFiles(current))
  const added = homeFileFields(input).filter(([, path]) => !known.has(path))
  const stored = await Promise.all(added.map(([, path]) => exists(path)))
  const missing = added.find((_, i) => !stored[i])
  if (missing) {
    const [field, path] = missing
    throw new UserError(isSiteVideoPath(path) ? "homeEditor.errors.video" : "homeEditor.errors.photo", { field })
  }
}
