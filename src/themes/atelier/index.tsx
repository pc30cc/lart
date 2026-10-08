import { themeDefaultFonts } from "../ids"
import type { SiteFrameProps, Theme } from "../types"
import { About } from "./about"
import { Footer } from "./footer"
import { Header } from "./header"
import { Home } from "./home"
import { WorkshopCard } from "./workshop-card"

/**
 * Atelier: the premium theme after the owner's earlier site (throttlehaus.ca),
 * in the owner's palette (cream, beige, brick, dark brown; theme.css) and
 * photos (photos.ts). A sticky header that is see-through over the home
 * page's full-screen hero, rounded photo bands, framed workshop cards and a
 * dark brown footer ending in the brand (or its logo) as a giant wordmark.
 */
function Frame({ locale, brand, logo, member, top, banner, nav, footer, children }: SiteFrameProps) {
  return (
    <>
      <Header brand={brand} logo={logo} member={member} top={top} nav={nav} overHero={!banner} />
      {/* The hero starts under the banner instead of under the header (theme.css). */}
      {banner && <div data-at-banner>{banner}</div>}
      <main className="flex flex-1 flex-col">{children}</main>
      <Footer brand={brand} logo={logo} locale={locale} member={member} nav={nav} footer={footer} />
    </>
  )
}

export const atelierTheme: Theme = {
  id: "atelier",
  Frame,
  Home,
  About,
  WorkshopCard,
  themeColor: { light: "#F2E9E5", dark: "#24160F" },
  fonts: themeDefaultFonts.atelier,
}
