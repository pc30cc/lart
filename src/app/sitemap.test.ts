import { describe, expect, it, vi } from "vitest"

import { env } from "@/lib/env"
import robots from "./robots"
import sitemap from "./sitemap"

vi.mock("next/server", () => ({ connection: async () => {} }))
const updatedAt = new Date("2026-10-01T09:00:00Z")
vi.mock("@/features/registrations/public", () => ({
  sitemapWorkshops: async () => [{ slug: "candle-making", updatedAt }],
}))
vi.mock("@/lib/settings", () => ({ getSetting: async () => "tr" }))

const url = (path: string) => new URL(path, env.APP_URL).href

describe("sitemap.xml", () => {
  it("lists the workshops page and each open workshop in every language, with hreflang alternates", async () => {
    const entries = await sitemap()
    expect(entries.map((e) => e.url)).toEqual([
      url("/fa/workshops"),
      url("/tr/workshops"),
      url("/en/workshops"),
      url("/fa/workshops/candle-making"),
      url("/tr/workshops/candle-making"),
      url("/en/workshops/candle-making"),
    ])
    expect(entries[4]).toMatchObject({
      lastModified: updatedAt,
      alternates: {
        languages: {
          fa: url("/fa/workshops/candle-making"),
          tr: url("/tr/workshops/candle-making"),
          en: url("/en/workshops/candle-making"),
          "x-default": url("/tr/workshops/candle-making"),
        },
      },
    })
    expect(entries.some((e) => /\/(admin|instructor|account)(\/|$)/.test(new URL(e.url).pathname))).toBe(false)
  })
})

describe("robots.txt", () => {
  it("keeps crawlers out of the private areas and the APIs, and points to the sitemap", async () => {
    const { rules, sitemap: map } = await robots()
    expect(rules).toMatchObject({ userAgent: "*", allow: "/" })
    const disallow = (rules as { disallow: string[] }).disallow
    for (const area of ["admin", "instructor", "account"]) {
      for (const locale of ["fa", "tr", "en"]) expect(disallow).toContain(`/${locale}/${area}`)
    }
    expect(disallow).toContain("/api")
    expect(map).toBe(url("/sitemap.xml"))
  })
})
