import { NextIntlClientProvider } from "next-intl"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { HomeData, WorkshopCard } from "../types"
import { atelierTheme } from "."

// Outside a Next.js request: plain links (with the query of an object href)
// and the texts of the real messages.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string | { pathname: string; query?: Record<string, string> }; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : `${href.pathname}?${new URLSearchParams(href.query)}`} {...rest}>
      {children}
    </a>
  ),
}))

const messages = {
  common: (await import("../../../messages/en/common.json")).default,
  site: (await import("../../../messages/en/site.json")).default,
  registration: (await import("../../../messages/en/registration.json")).default,
  home: (await import("../../../messages/en/home.json")).default,
}

const startsAt = new Date(Date.now() + 5 * 86_400_000)
const workshop = (slug: string, title: string): WorkshopCard => ({
  id: slug,
  slug,
  title,
  venue: "Moda",
  category: "Candles",
  instructorName: "Zeynep",
  coverUrl: null,
  startsAt,
  endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
  registrationDeadline: startsAt,
  price: 150_000,
  maxCapacity: 10,
  seatsLeft: 2,
  ageMin: null,
  ageMax: null,
  window: "open",
})

/** A home page with every section, as getHomeData builds it. */
const full = (): HomeData => ({
  locale: "en",
  brand: "Limer",
  tagline: "Art workshops in Istanbul.",
  hero: { media: { kind: "theme" }, title: "Make something beautiful", subtitle: "Small, warm workshops.", button: "Explore workshops" },
  upcoming: [workshop("candles", "Scented candles"), workshop("macrame", "Macramé")],
  categories: [
    { slug: "candles", name: "Candle making", count: 2 },
    { slug: "ceramics", name: "Ceramics", count: 1 },
  ],
  story: { title: "A place to create together", text: "Every workshop is a small gathering.", button: "Upcoming workshops", imageUrl: null },
  crafts: { title: "Explore by craft", imageUrl: null },
  past: {
    title: "From past workshops",
    workshops: [
      { slug: "soy", title: "Soy candles", startsAt: new Date("2026-09-06T10:00:00Z"), coverUrl: "https://cdn.test/soy.webp", photos: [] },
      { slug: "bare", title: "No photos at all", startsAt: new Date("2026-08-06T10:00:00Z"), coverUrl: null, photos: [] },
    ],
  },
  steps: {
    title: "How it works",
    items: [
      { title: "Choose a workshop", text: "See the date." },
      { title: "Come and create", text: "Everything is ready." },
    ],
    imageUrl: null,
  },
  labels: {
    upcomingTitle: "Coming up",
    allWorkshops: "All workshops",
    seeAllWorkshops: "See all workshops",
    emptyTitle: "New workshops are coming soon",
    emptyText: "Nothing is open right now.",
  },
})

function render(data: HomeData) {
  const Home = atelierTheme.Home as (props: { data: HomeData }) => React.ReactNode
  return renderToString(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Istanbul">
      <Home data={data} />
    </NextIntlClientProvider>,
  )
}

const h1s = (html: string) => [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""))
/** The texts of the links to exactly `href`. */
const linksTo = (html: string, href: string) =>
  [...html.matchAll(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/gs)]
    .filter((m) => m[1].replaceAll("&amp;", "&") === href)
    .map((m) => m[2].replace(/<[^>]+>/g, "").trim())

describe("the Atelier home page", () => {
  it("has one h1, the brand, and every section with its links", () => {
    const html = render(full())
    expect(h1s(html)).toEqual(["Limer"])
    expect(html).toContain("Make something beautiful")
    // The hero, "All workshops" (start of the row on a computer, under the cards on a phone) and the story.
    expect(linksTo(html, "/workshops")).toEqual(["Explore workshops", "All workshops", "All workshops", "Upcoming workshops"])
    expect(html).toContain('href="/workshops/candles"')
    expect(html).toContain('href="/workshops/macrame"')
    expect(linksTo(html, "/workshops?category=candles")).toEqual(["Candle making"])
    expect(linksTo(html, "/workshops?category=ceramics")).toEqual(["Ceramics"])
    expect(html).toContain("A place to create together")
    expect(html).toContain("From past workshops")
    // A past workshop without any photo is left out of the gallery.
    expect(html).toContain('href="/workshops/soy"')
    expect(html).not.toContain('href="/workshops/bare"')
    expect(html).toContain("How it works")
    // The theme's own photos, described.
    expect(html).toContain('src="/themes/atelier/')
    expect(html).toContain('alt="Women pouring candles around a wooden table"')
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/)
  })

  it("leaves out the sections the admin hid, and the crafts without categories", () => {
    const html = render({ ...full(), story: null, past: null, steps: null, categories: [] })
    expect(h1s(html)).toEqual(["Limer"])
    expect(html).not.toContain("A place to create together")
    expect(html).not.toContain("Explore by craft")
    expect(html).not.toContain("?category=")
    expect(html).not.toContain("From past workshops")
    expect(html).not.toContain("How it works")
    expect(html).not.toMatch(/undefined|NaN/)
  })

  it("leaves out a past gallery without photos and the crafts the admin hid", () => {
    const data = full()
    const html = render({ ...data, crafts: null, past: { ...data.past!, workshops: [data.past!.workshops[1]] } })
    expect(html).not.toContain("From past workshops")
    expect(html).not.toContain("?category=")
  })

  it("shows a calm note and no way to an empty list when no workshop is open", () => {
    const html = render({ ...full(), upcoming: [] })
    expect(html).toContain("New workshops are coming soon")
    expect(linksTo(html, "/workshops")).toEqual(["Explore workshops", "Upcoming workshops"])
  })

  it("plays the admin's video with its poster, or shows the admin's photos", () => {
    const video = render({
      ...full(),
      hero: { ...full().hero, media: { kind: "video", url: "https://cdn.test/hero.mp4", posterUrl: "https://cdn.test/poster.webp" } },
    })
    expect(video).toMatch(/<video[^>]*src="https:\/\/cdn.test\/hero.mp4"/)
    expect(video).toContain('poster="https://cdn.test/poster.webp"')
    expect(video).toMatch(/<video[^>]*autoPlay|<video[^>]*autoplay/)

    const photos = render({ ...full(), hero: { ...full().hero, media: { kind: "images", images: ["https://cdn.test/a.webp", "https://cdn.test/b.webp"] } } })
    expect(photos).toContain('src="https://cdn.test/a.webp"')
    expect(photos).not.toContain("hero.mp4")
  })
})
