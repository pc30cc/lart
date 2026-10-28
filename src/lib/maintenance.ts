import "server-only"
import { and, desc, ne } from "drizzle-orm"

import { db } from "@/db"
import { courses } from "@/db/schema"
import { getMainLocaleState } from "@/i18n/main-locale"

/**
 * Maintenance ("در دست تعمیر"): turned on and off in the database only, never
 * from the panel:
 *
 *   insert into settings (key, value) values ('maintenance', 'true')
 *     on conflict (key) do update set value = 'true';   -- on
 *   delete from settings where key = 'maintenance';      -- off
 *
 * Every process follows within 30 seconds (it is cached with the main
 * language, i18n/main-locale.ts). While it is on:
 * - every page and API outside the admin panel shows only the logo on the
 *   brand colour (src/proxy.ts), 200 with noindex,
 * - in the admin panel nothing can be changed or removed (`adminAction`),
 *   except recording an expense of the latest workshop (`latestWorkshop`) or
 *   a general one (how a closed workshop's later cost is recorded, its name
 *   in the text), with its receipts; signing in and out still work.
 */
export async function isMaintenance(): Promise<boolean> {
  return (await getMainLocaleState()).maintenance
}

/** The latest workshop (the last to start, not cancelled): the only one an expense can be recorded for during maintenance. */
export async function latestWorkshop(): Promise<{ id: string; title: Record<string, string> } | null> {
  const [row] = await db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(and(ne(courses.status, "cancelled")))
    .orderBy(desc(courses.startsAt))
    .limit(1)
  return row ? { id: row.id, title: row.title as Record<string, string> } : null
}
