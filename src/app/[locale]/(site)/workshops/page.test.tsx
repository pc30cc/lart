import { NextIntlClientProvider } from "next-intl"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkshopCard } from "@/features/registrations/public"
import type { PublicCategory } from "@/themes/types"
import WorkshopsPage, { generateMetadata } from "./page"

// Outside a Next.js request: plain links, the real English texts, a bare card
// for the theme, and the open workshops and categories per test.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, scroll, children, ...rest }: { href: string | { pathname: string; query: Record<string, string> }; scroll?: boolean; children: React.ReactNode }) => {
    void scroll
    return (
      <a href={typeof href === "string" ? href : `${href.pathname}?${new URLSearchParams(href.query)}`} {...rest}>
        {children}
      </a>
    )
  },
}))
const messages = vi.hoisted(async () => ({
  common: (await import("../../../../../messages/en/common.json")).default,
  registration: (await import("../../../../../messages/en/registration.json")).default,
}))
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const all = await messages
  return {
    getTranslations: async (arg?: string | { namespace?: string }) =>
      createTranslator({ locale: "en", messages: all, namespace: (typeof arg === "string" ? arg : arg?.namespace) as never }),
  }
})

const state = vi.hoisted(() => ({ workshops: [] as WorkshopCard[], categories: [] as PublicCategory[] }))
vi.mock("@/features/registrations/public", () => ({
  listOpenWorkshops: vi.fn(async (_locale: string, { category }: { category?: string } = {}) =>
    state.workshops.filter((w) => !category || w.categorySlug === category),
  ),
}))
vi.mock("@/features/site/public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/site/public")>()),
  listPublicCategories: async () => state.categories,
}))
vi.mock("@/themes/registry", () => ({
  getActiveTheme: async () => ({ theme: { WorkshopCard: ({ workshop }: { workshop: WorkshopCard }) => <article>{workshop.title}</article> } }),
}))
vi.mock("@/lib/settings", () => ({ getBrand: async () => "Limer" }))
vi.mock("@/lib/seo", () => ({ alternates: async (path: string) => ({ canonical: `http://localhost${path}` }), ogLocale: {} }))

const { listOpenWorkshops } = vi.mocked(await import("@/features/registrations/public"))

const card = (n: number, categorySlug: string): WorkshopCard => {
  const startsAt = new Date(Date.now() + (n + 1) * 86_400_000)
  return {
    id: `w${n}`,
    slug: `w-${n}`,
    title: `Workshop ${n} (${categorySlug})`,
    venue: "Moda",
    category: categorySlug,
    categorySlug,
    instructorName: "Zeynep",
    coverUrl: null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 7_200_000),
    registrationDeadline: startsAt,
    price: 150_000,
    maxCapacity: 10,
    seatsLeft: 4,
    ageMin: null,
    ageMax: null,
    window: "open",
  }
}

const props = (query: Record<string, string | string[]> = {}) =>
  ({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve(query) }) as PageProps<"/[locale]/workshops">

async function render(query?: Record<string, string | string[]>) {
  const page = await WorkshopsPage(props(query))
  return renderToString(
    <NextIntlClientProvider locale="en" messages={await messages} timeZone="Europe/Istanbul">
      {page}
    </NextIntlClientProvider>,
  )
}

const titles = (html: string) => [...html.matchAll(/<article>(.*?)<\/article>/g)].map((m) => m[1])
/** The filter's links: [text, href, current]. */
const pills = (html: string) =>
  [...html.matchAll(/<a href="([^"]*)"([^>]*)>(.*?)<\/a>/g)].map((m) => [m[3], m[1].replace(/&amp;/g, "&"), m[2].includes('aria-current="page"')])

beforeEach(() => {
  state.workshops = [card(0, "candles"), card(1, "ceramics"), card(2, "candles")]
  state.categories = [
    { slug: "candles", name: "Candles", count: 2 },
    { slug: "ceramics", name: "Ceramics", count: 1 },
  ]
  vi.clearAllMocks()
})

describe("/workshops", () => {
  it("shows every open workshop and the craft filter, with All marked", async () => {
    const html = await render()
    expect(html).toMatch(/<h1[^>]*>Workshops<\/h1>/)
    expect(titles(html)).toEqual(["Workshop 0 (candles)", "Workshop 1 (ceramics)", "Workshop 2 (candles)"])
    expect(html).toContain('<nav aria-label="Workshops by craft"')
    expect(pills(html)).toEqual([
      ["All", "/workshops", true],
      ["Candles", "/workshops?category=candles", false],
      ["Ceramics", "/workshops?category=ceramics", false],
    ])
    expect(listOpenWorkshops).toHaveBeenCalledTimes(1)
    expect(listOpenWorkshops).toHaveBeenCalledWith("en")
  })

  it("?category=<slug> shows that craft's workshops, its link marked", async () => {
    const html = await render({ category: "ceramics" })
    expect(titles(html)).toEqual(["Workshop 1 (ceramics)"])
    expect(pills(html).filter(([, , current]) => current)).toEqual([["Ceramics", "/workshops?category=ceramics", true]])
    expect(listOpenWorkshops).toHaveBeenCalledWith("en", { category: "ceramics" })
  })

  it("an unknown or malformed category shows the whole list, without an error", async () => {
    for (const category of ["no-such-craft", "../admin", "Candles", ["x y"]]) {
      vi.clearAllMocks()
      const html = await render({ category })
      expect(titles(html), String(category)).toHaveLength(3)
      expect(pills(html)[0], String(category)).toEqual(["All", "/workshops", true])
    }
    // A malformed one is never looked up.
    expect(listOpenWorkshops).toHaveBeenCalledTimes(1)
    expect(listOpenWorkshops).toHaveBeenCalledWith("en")
  })

  it("no filter with a single craft, and the empty state when nothing is open", async () => {
    state.categories = [{ slug: "candles", name: "Candles", count: 3 }]
    expect(await render()).not.toContain("<nav")

    state.workshops = []
    state.categories = []
    const html = await render({ category: "candles" })
    expect(html).not.toContain("<nav")
    expect(html).toContain("New workshops are coming soon")
  })

  it("keeps one canonical address; a filtered view is not indexed but its links are followed", async () => {
    const plain = await generateMetadata(props())
    expect(plain.alternates?.canonical).toBe("http://localhost/workshops")
    expect(plain.robots).toBeUndefined()

    const filtered = await generateMetadata(props({ category: "candles" }))
    expect(filtered.alternates?.canonical).toBe("http://localhost/workshops")
    expect(filtered.robots).toEqual({ index: false, follow: true })
  })
})
