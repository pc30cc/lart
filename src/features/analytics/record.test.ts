import { gte } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { pageViews } from "@/db/schema"
import { getVisitStats } from "./queries"
import { pruneViews, recordView } from "./record"

vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => ({ admin: { id: "x" } }) }))

// Far in the future, so no other test's rows fall in the periods read here.
const NOW = new Date("2031-03-15T12:00:00Z")
const HOUR = 3_600_000
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"

const from = (ip: string, ua: string, extra: Record<string, string> = {}) =>
  new Headers({ "x-real-ip": ip, "user-agent": ua, ...extra })

afterAll(async () => {
  await db.delete(pageViews).where(gte(pageViews.at, new Date("2030-01-01")))
})

describe("visit statistics", () => {
  it("counts people once a day, never robots or the private pages, and keeps no IP address", async () => {
    const a = from("198.51.100.7", PHONE, { "cf-ipcountry": "TR" })
    expect(await recordView({ path: "/", locale: "fa", referrer: "https://www.google.com/" }, a, NOW)).toBe(true)
    expect(await recordView({ path: "/workshops", locale: "fa" }, a, new Date(NOW.getTime() + HOUR))).toBe(true)
    expect(await recordView({ path: "/", locale: "en" }, from("198.51.100.8", MAC), NOW)).toBe(true)
    // The same person the next day is a new visitor that day.
    expect(await recordView({ path: "/", locale: "fa" }, a, new Date(NOW.getTime() - 24 * HOUR))).toBe(true)

    expect(await recordView({ path: "/", locale: "fa" }, from("198.51.100.9", "Googlebot/2.1"), NOW)).toBe(false)
    expect(await recordView({ path: "/account", locale: "fa" }, a, NOW)).toBe(false)
    expect(await recordView({ path: "/admin/money", locale: "fa" }, a, NOW)).toBe(false)
    expect(await recordView({ path: "/", locale: "de" }, a, NOW)).toBe(false)

    const rows = await db.select().from(pageViews).where(gte(pageViews.at, new Date("2030-01-01")))
    expect(rows).toHaveLength(4)
    expect(JSON.stringify(rows)).not.toContain("198.51.100")
    const today = rows.filter((r) => r.at.getTime() >= NOW.getTime() - HOUR)
    expect(new Set(today.map((r) => r.visitor)).size).toBe(2)
    expect(rows.find((r) => r.referrer)).toMatchObject({ referrer: "google.com", device: "mobile", country: "TR", path: "/" })

    const stats = await getVisitStats(7, new Date(NOW.getTime() + 2 * HOUR))
    expect(stats.totals).toMatchObject({ views: 4, visitors: 3 })
    expect(stats.daily).toHaveLength(7)
    expect(stats.daily.at(-1)).toMatchObject({ day: "2031-03-15", views: 3, visitors: 2 })
    expect(stats.pages[0]).toMatchObject({ path: "/", views: 3, visitors: 3 })
    expect(stats.devices).toEqual([
      { key: "mobile", visitors: 2 },
      { key: "desktop", visitors: 1 },
    ])
    expect(stats.referrers).toContainEqual({ host: "google.com", visitors: 1 })
  })

  it("deletes views older than 13 months", async () => {
    const old = new Date(NOW.getTime() - 401 * 24 * HOUR)
    await recordView({ path: "/", locale: "tr" }, from("198.51.100.20", MAC), old)
    expect(await pruneViews(NOW)).toBeGreaterThanOrEqual(1)
    const left = await db.select().from(pageViews).where(gte(pageViews.at, new Date("2030-01-01")))
    expect(left.every((r) => r.at > old)).toBe(true)
  })
})
