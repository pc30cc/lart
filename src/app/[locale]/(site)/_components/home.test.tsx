import { NextIntlClientProvider } from "next-intl"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkshopCard } from "@/features/registrations/public"
import HomePage from "../page"

// Outside a Next.js request: plain links, the texts of the real messages, and
// the data the page reads (open workshops, brand, settings) per test. No theme
// is saved, so the page shows the classic theme.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const messages = vi.hoisted(async () => ({
  common: (await import("../../../../../messages/en/common.json")).default,
  site: (await import("../../../../../messages/en/site.json")).default,
  registration: (await import("../../../../../messages/en/registration.json")).default,
  home: (await import("../../../../../messages/en/home.json")).default,
}))
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const all = await messages
  return {
    getTranslations: async (arg?: string | { namespace?: string }) =>
      createTranslator({ locale: "en", messages: all, namespace: (typeof arg === "string" ? arg : arg?.namespace) as never }),
  }
})

const data = vi.hoisted(() => ({ workshops: [] as WorkshopCard[] }))
vi.mock("@/features/registrations/public", () => ({ listOpenWorkshops: async () => data.workshops }))
vi.mock("@/features/site/public", () => ({ listPublicCategories: async () => [], listPastWorkshops: async () => [] }))
vi.mock("@/lib/storage", () => ({ publicUrls: async () => () => null }))
vi.mock("@/lib/settings", async () => {
  const { settingDefaults } = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  const saved: Record<string, unknown> = { seo: { title: {}, description: { en: "Art workshops in Istanbul." } } }
  return {
    getBrand: async () => "Lart",
    getSetting: async (key: keyof typeof settingDefaults) => saved[key] ?? settingDefaults[key],
  }
})
vi.mock("@/lib/seo", () => ({ alternates: async () => ({}), ogLocale: {} }))

const startsAt = new Date(Date.now() + 5 * 86_400_000)
const workshop: WorkshopCard = {
  id: "w1",
  slug: "candles",
  title: "Candles",
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
}

async function render() {
  const page = await HomePage({ params: Promise.resolve({ locale: "en" }) } as PageProps<"/[locale]">)
  return renderToString(
    <NextIntlClientProvider locale="en" messages={await messages} timeZone="Europe/Istanbul">
      {page}
    </NextIntlClientProvider>,
  )
}

/** The links to the workshops list, by their text. */
const linksToList = (html: string) =>
  [...html.matchAll(/<a href="\/workshops"[^>]*>(.*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim())

beforeEach(() => {
  data.workshops = []
})

describe("the home page", () => {
  it("shows the brand, the SEO description and the next workshops, with the way to all of them", async () => {
    data.workshops = [workshop]
    const html = await render()
    expect(html).toContain("Lart</h1>")
    expect(html).toContain("Art workshops in Istanbul.")
    expect(html).toContain('href="/workshops/candles"')
    expect(linksToList(html)).toEqual(["See all workshops", "All workshops", "All workshops"])
  })

  it("has no button to an empty list when no workshop is open: only the coming-soon note", async () => {
    const html = await render()
    expect(html).toContain("Lart</h1>")
    expect(html).toContain("New workshops are coming soon")
    expect(linksToList(html)).toEqual([])
  })
})
