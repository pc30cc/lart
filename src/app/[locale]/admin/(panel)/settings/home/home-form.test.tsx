import { NextIntlClientProvider } from "next-intl"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { HomeDefaults, HomeSettingsValues, Texts } from "@/features/site/home-schema"
import { settingDefaults } from "@/lib/settings"
import { HomeSettingsForm } from "./home-form"

// Outside a Next.js request: plain links.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => "/admin/settings/home",
}))

const load = async (l: string) => ({
  common: (await import(`../../../../../../../messages/${l}/common.json`)).default,
  settings: (await import(`../../../../../../../messages/${l}/settings.json`)).default,
  media: (await import(`../../../../../../../messages/${l}/media.json`)).default,
  homeEditor: (await import(`../../../../../../../messages/${l}/homeEditor.json`)).default,
})

const texts = (text: string): Texts => ({ fa: `${text} fa`, tr: `${text} tr`, en: `${text} en` })
const defaults: HomeDefaults = {
  hero: { title: texts("Hero title"), subtitle: texts("Hero subtitle"), button: texts("Hero button") },
  story: { title: texts("Story title"), text: texts("Story text"), button: texts("Story button") },
  crafts: { title: texts("Crafts title") },
  past: { title: texts("Past title") },
  steps: { title: texts("Steps title"), items: [1, 2, 3, 4].map((n) => ({ title: texts(`Step ${n}`), text: texts(`Step ${n} text`) })) },
  footer: { about: texts("About") },
}
const photo = "site/img-AbC_-123AbC_-123AbC_-1.webp"
const saved: HomeSettingsValues = {
  ...settingDefaults.home,
  hero: { ...settingDefaults.home.hero, media: "images", images: [photo], title: { tr: "Birlikte üretelim" } },
  crafts: { show: false, title: {}, image: "" },
  footer: { ...settingDefaults.home.footer, instagram: "https://instagram.com/limer.tr" },
}

/** The editor renders on the server in each language with the real texts (a missing text throws). */
describe.each(["fa", "tr", "en"])("the home page editor in %s", (locale) => {
  const render = async (node: React.ReactNode) =>
    renderToString(
      <NextIntlClientProvider
        locale={locale}
        messages={await load(locale)}
        timeZone="Europe/Istanbul"
        onError={(error) => {
          throw error
        }}
      >
        {node}
      </NextIntlClientProvider>,
    )

  it("shows the saved content, the photos, and the theme's texts as placeholders in every language", async () => {
    const html = await render(<HomeSettingsForm saved={saved} urls={{ [photo]: "/media/x.webp" }} defaults={defaults} classic />)
    expect(html).toContain('value="Birlikte üretelim"')
    expect(html).toContain('src="/media/x.webp"')
    expect(html).toContain('value="https://instagram.com/limer.tr"')
    for (const l of ["fa", "tr", "en"]) {
      expect(html).toContain(`placeholder="Hero subtitle ${l}"`)
      expect(html).toContain(`placeholder="Step 4 text ${l}"`)
    }
    expect(html).not.toContain("Crafts title") // hidden section: its fields are folded away
    expect(html).toContain('href="/admin/settings/appearance"')
  })

  it("shows the video and its cover photo when the background is a video", async () => {
    const video = { ...saved, hero: { ...saved.hero, media: "video" as const, video: "site/video-AbC_-123AbC_-123AbC_-1.mp4" } }
    const html = await render(<HomeSettingsForm saved={video} urls={{ [video.hero.video]: "/media/v.mp4" }} defaults={defaults} classic={false} />)
    expect(html).toContain('src="/media/v.mp4"')
    expect(html).not.toContain('href="/admin/settings/appearance"')
  })
})
