"use server"

import { eq } from "drizzle-orm"
import { refresh } from "next/cache"

import { db } from "@/db"
import { settings } from "@/db/schema"
import { adminAction } from "@/lib/action"
import { changes } from "@/lib/audit"
import { errorForLog } from "@/lib/errors"
import { setSetting, settingDefaults, settingSchemas, type SettingValue } from "@/lib/settings"
import { remove } from "@/lib/storage"
import { homeFiles, homeSettingsSchema, isSiteImagePath, isSiteVideoPath } from "./home-schema"

type Home = SettingValue<"home">

const sections = ["hero", "story", "crafts", "past", "steps", "footer"] as const

/**
 * The home page's content (Settings → Home page). Audited as one
 * `setting.update` entry with what changed per field ("hero.title": { from, to }).
 * Photos and the video no longer used are removed from storage after the
 * change is saved (a file that cannot be removed is only logged).
 */
export const saveHomeSettings = adminAction(homeSettingsSchema, async (input, ctx) => {
  const before = await db.transaction(async (tx) => {
    // Read under a lock, so two saves at once never remove a file the other one keeps.
    const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, "home")).for("update")
    const parsed = row ? settingSchemas.home.safeParse(row.value) : null
    const current: Home = parsed?.success ? parsed.data : settingDefaults.home

    const diff = Object.fromEntries(
      sections.flatMap((section) =>
        Object.entries(changes(current[section] as Record<string, unknown>, input[section])).map(([field, change]) => [
          `${section}.${field}`,
          change,
        ]),
      ),
    )
    if (Object.keys(diff).length === 0) return null
    await setSetting("home", input, tx)
    await ctx.audit({ action: "setting.update", entity: "setting", entityId: "home", data: diff }, tx)
    return current
  })
  if (!before) return { changed: false }

  // Only files of the home page (site/…) are ever removed here.
  const kept = new Set(homeFiles(input))
  const unused = [...new Set(homeFiles(before))].filter((path) => !kept.has(path) && (isSiteImagePath(path) || isSiteVideoPath(path)))
  await Promise.all(
    unused.map((path) => remove(path).catch((err) => console.warn("[home settings] unused file not removed", errorForLog(err)))),
  )
  refresh()
  return { changed: true }
})
