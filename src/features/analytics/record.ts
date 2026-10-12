import "server-only"
import { createHmac } from "node:crypto"
import { lt } from "drizzle-orm"

import { db } from "@/db"
import { pageViews } from "@/db/schema"
import { isAppLocale } from "@/i18n/locales"
import { clientIp } from "@/lib/auth/client-ip"
import { env } from "@/lib/env"
import { zonedParts } from "@/lib/format"
import { cleanPath, deviceOf, isRobot, referrerHost, type ViewReport } from "./shared"

/**
 * Count one page seen on the public site (the page's beacon, POST
 * /api/view). No cookie and no IP address is kept: the visitor is a keyed
 * hash of the address, the browser and the Istanbul day (HMAC with a key
 * derived from ENCRYPTION_KEY), so one person counts once a day and cannot
 * be followed across days. Robots, the private areas and malformed reports
 * are left out. Returns whether a view was stored.
 */
export async function recordView(report: ViewReport, headers: Headers, now: Date = new Date()): Promise<boolean> {
  const userAgent = headers.get("user-agent")
  if (isRobot(userAgent) || !userAgent) return false
  const path = cleanPath(report.path)
  if (!path || !isAppLocale(report.locale)) return false
  // Only the public site: the member's, instructor's and admin's pages are not visits.
  if (/^\/(account|instructor|admin)(\/|$)/.test(path)) return false

  const day = zonedParts(now).date
  const visitor = createHmac("sha256", visitorKey())
    .update(`${day}\n${clientIp(headers) ?? "unknown"}\n${userAgent}`)
    .digest("base64url")
    .slice(0, 22)
  const country = headers.get("cf-ipcountry")?.toUpperCase()
  await db.insert(pageViews).values({
    at: now,
    path,
    locale: report.locale,
    visitor,
    referrer: referrerHost(report.referrer, new URL(env.APP_URL).hostname),
    device: deviceOf(userAgent),
    country: country && /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : null,
  })
  return true
}

/** The key of the visitor hash: derived from ENCRYPTION_KEY, used for nothing else. */
let key: Buffer | null = null
function visitorKey(): Buffer {
  key ??= createHmac("sha256", Buffer.from(env.ENCRYPTION_KEY, "base64")).update("lart:page-views:visitor").digest()
  return key
}

/** How long the statistics are kept: 13 months, so a year can be compared with the one before it. */
export const KEEP_DAYS = 400

/** Delete the views older than KEEP_DAYS (the scheduled jobs). */
export async function pruneViews(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - KEEP_DAYS * 24 * 3_600_000)
  const gone = await db.delete(pageViews).where(lt(pageViews.at, before)).returning({ id: pageViews.id })
  return gone.length
}
