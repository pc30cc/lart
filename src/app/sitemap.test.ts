import { describe, expect, it, vi } from "vitest"

import { env } from "@/lib/env"
import robots from "./robots"
import sitemap from "./sitemap"

// The main language is "tr" (the global mock in test/setup.ts): its addresses have no prefix.
vi.mock("next/server", () => ({ connection: async () => {} }))
const updatedAt = new Date("2026-10-01T09:00:00Z")
vi.mock("@/features/registrations/public", () => ({
  sitemapWorkshops: async () => [{ slug: "candle-making", updatedAt }],
}))
const story = vi.hoisted(() => ({ hasPartners: true }))
vi.mock("@/features/site/about", () => ({ storyHasPartners: async () => story.hasPartners }))

const url = (path: string) => new URL(path, env.APP_URL).href

describe("sitemap.xml", () => {
  it("lists the home page, the workshops page and each open workshop in every language, the main one without a prefix", async () => {
    const entries = await sitemap()
    expect(entries.map((e) => e.url)).toEqual([
      url("/fa"),
      url("/"),
      url("/en"),
      url("/fa/workshops"),
      url("/workshops"),
      url("/en/workshops"),
      url("/fa/workshops/candle-making"),
      url("/workshops/candle-making"),
      url("/en/workshops/candle-making"),
      url("/fa/about"),
      url("/about"),
      url("/en/about"),
      url("/fa/story"),
      url("/story"),
      url("/en/story"),
    ])
    expect(entries[1]).toMatchObject({
      priority: 1,
      lastModified: updatedAt,
      alternates: { languages: { fa: url("/fa"), tr: url("/"), en: url("/en"), "x-default": url("/") } },
    })
    expect(entries[7]).toMatchObject({
      lastModified: updatedAt,
      alternates: {
        languages: {
          fa: url("/fa/workshops/candle-making"),
          tr: url("/workshops/candle-making"),
          en: url("/en/workshops/candle-making"),
          "x-default": url("/workshops/candle-making"),
        },
      },
    })
    expect(entries.some((e) => /\/(admin|instructor|account)(\/|$)/.test(new URL(e.url).pathname))).toBe(false)
    // No filtered views of the list (?category=).
    expect(entries.some((e) => new URL(e.url).search !== "")).toBe(false)
    expect(entries.some((e) => /^\/tr(\/|$)/.test(new URL(e.url).pathname))).toBe(false)
    // No trailing slash on a language's home page.
    expect(entries.some((e) => /\/(fa|en)\/$/.test(e.url))).toBe(false)
  })

  it("leaves the Our story page out while no partner is on it (it is not indexed then); the About page stays", async () => {
    story.hasPartners = false
    const entries = await sitemap()
    story.hasPartners = true
    expect(entries.some((e) => new URL(e.url).pathname.endsWith("/story"))).toBe(false)
    expect(entries.filter((e) => new URL(e.url).pathname.endsWith("/about"))).toHaveLength(3)
    expect(entries).toHaveLength(12)
  })
})

describe("robots.txt", () => {
  it("keeps crawlers out of the super-admin panel and the APIs, and points to the sitemap", async () => {
    const { rules, sitemap: map } = await robots()
    expect(rules).toMatchObject({ userAgent: "*", allow: "/" })
    const disallow = (rules as { disallow: string[] }).disallow
    expect(disallow).toContain("/admin")
    for (const locale of ["fa", "tr", "en"]) expect(disallow).toContain(`/${locale}/admin`)
    expect(disallow).toContain("/api")
    expect(map).toBe(url("/sitemap.xml"))
  })

  it("does not name the instructor panel or the account pages, so crawlers see their noindex and the panel's address stays private", async () => {
    const { rules } = await robots()
    const disallow = (rules as { disallow: string[] }).disallow
    expect(disallow.some((path) => /instructor|account/.test(path))).toBe(false)
  })
})
