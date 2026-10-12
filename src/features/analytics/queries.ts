import "server-only"
import { and, count, countDistinct, desc, gte, inArray, lt, sql } from "drizzle-orm"

import { db } from "@/db"
import { courses, pageViews } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { zonedParts, zonedToIso } from "@/lib/format"

/** The periods the page offers, in days (the last N Istanbul days, today included). */
export const ranges = [7, 30, 90, 365] as const
export type Range = (typeof ranges)[number]
export const parseRange = (value: unknown): Range => (ranges as readonly number[]).includes(Number(value)) ? (Number(value) as Range) : 30

const DAY = 24 * 3_600_000
/** Istanbul day of a view. */
const dayOf = sql<string>`to_char(${pageViews.at} at time zone 'Europe/Istanbul', 'YYYY-MM-DD')`

/** The first instant of the Istanbul day `days - 1` days before today, and of the period before it. */
function bounds(days: number, now: Date) {
  const today = zonedParts(now).date
  const start = new Date(zonedToIso(today, "00:00")!)
  const from = new Date(start.getTime() - (days - 1) * DAY)
  return { from, before: new Date(from.getTime() - days * DAY), today }
}

/** Every Istanbul day from `from` to `today` ("YYYY-MM-DD"). */
function dayList(from: Date, today: string): string[] {
  const out: string[] = []
  for (let t = from.getTime() + 12 * 3_600_000; ; t += DAY) {
    const d = zonedParts(new Date(t)).date
    out.push(d)
    if (d >= today) return out
  }
}

/**
 * The visit statistics of the last `days` days for the panel: totals (with
 * the period before, for the change), one point per day, the most seen pages
 * (a workshop's page named by its title), where visitors came from, devices,
 * languages and countries, and how many people are on the site now (the last
 * 30 minutes). A visitor is counted once a day (`recordView`).
 */
export async function getVisitStats(days: Range, now: Date = new Date()) {
  await requireAdmin()
  const { from, before, today } = bounds(days, now)
  const inRange = gte(pageViews.at, from)
  const visitors = countDistinct(sql`(${dayOf}, ${pageViews.visitor})`)

  const [[totals], [previous], daily, pages, referrers, deviceRows, localeRows, countryRows, [live]] = await Promise.all([
    db.select({ views: count(), visitors }).from(pageViews).where(inRange),
    db.select({ views: count(), visitors }).from(pageViews).where(and(gte(pageViews.at, before), lt(pageViews.at, from))),
    db.select({ day: dayOf, views: count(), visitors }).from(pageViews).where(inRange).groupBy(dayOf),
    db
      .select({ path: pageViews.path, views: count(), visitors })
      .from(pageViews)
      .where(inRange)
      .groupBy(pageViews.path)
      .orderBy(desc(count()))
      .limit(12),
    db
      .select({ host: pageViews.referrer, visitors })
      .from(pageViews)
      .where(inRange)
      .groupBy(pageViews.referrer)
      .orderBy(desc(visitors))
      .limit(10),
    db.select({ key: pageViews.device, visitors }).from(pageViews).where(inRange).groupBy(pageViews.device),
    db.select({ key: pageViews.locale, visitors }).from(pageViews).where(inRange).groupBy(pageViews.locale),
    db
      .select({ key: pageViews.country, visitors })
      .from(pageViews)
      .where(inRange)
      .groupBy(pageViews.country)
      .orderBy(desc(visitors))
      .limit(8),
    db
      .select({ n: countDistinct(pageViews.visitor) })
      .from(pageViews)
      .where(gte(pageViews.at, new Date(now.getTime() - 30 * 60_000))),
  ])

  // A workshop's page by its title.
  const slugs = pages.flatMap((p) => /^\/workshops\/([a-z0-9-]+)$/.exec(p.path)?.[1] ?? [])
  const titles = slugs.length
    ? await db.select({ slug: courses.slug, title: courses.title }).from(courses).where(inArray(courses.slug, slugs))
    : []
  const titleOf = new Map(titles.map((c) => [c.slug, c.title]))

  const perDay = new Map(daily.map((d) => [d.day, d]))
  const sorted = <T extends { visitors: number }>(rows: T[]) => [...rows].sort((a, b) => b.visitors - a.visitors)
  return {
    days,
    totals: { ...totals, previous },
    daily: dayList(from, today).map((day) => ({ day, views: perDay.get(day)?.views ?? 0, visitors: perDay.get(day)?.visitors ?? 0 })),
    pages: pages.map((p) => {
      const slug = /^\/workshops\/([a-z0-9-]+)$/.exec(p.path)?.[1]
      return { ...p, workshop: slug ? (titleOf.get(slug) ?? null) : null }
    }),
    referrers,
    devices: sorted(deviceRows),
    locales: sorted(localeRows),
    countries: countryRows,
    liveNow: live?.n ?? 0,
  }
}

export type VisitStats = Awaited<ReturnType<typeof getVisitStats>>

/** Whether any view was ever counted (the page says "nothing yet" otherwise). */
export async function hasViews(): Promise<boolean> {
  const [row] = await db.select({ id: pageViews.id }).from(pageViews).limit(1)
  return Boolean(row)
}

