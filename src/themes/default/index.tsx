import { SiteFooter } from "@/components/site/site-footer"
import { SiteHeader } from "@/components/site/site-header"
import { themeDefaultFonts } from "../ids"
import { About } from "./about"
import type { HomeData, SiteFrameProps, Theme } from "../types"
import { HomeHero } from "./home-hero"
import { UpcomingWorkshops } from "./upcoming-workshops"
import { WorkshopCard } from "./workshop-card"

/** How many workshops the classic home page shows; the rest are one click away (/workshops). */
const HOME_WORKSHOPS = 6

/**
 * The classic theme: the site's original look (shown as "Classic"; its id is
 * "default"). A quiet header, the brand and one sentence, the next workshops.
 */
function Frame({ locale, brand, logo, member, top, banner, nav, footer, children }: SiteFrameProps) {
  return (
    <>
      <SiteHeader brand={brand} logo={logo} member={member} top={top} nav={nav} />
      {banner}
      <main className="flex flex-1 flex-col">{children}</main>
      <SiteFooter brand={brand} locale={locale} signedIn={member !== null} nav={nav} footer={footer} />
    </>
  )
}

function Home({ data }: { data: HomeData }) {
  return (
    <>
      <HomeHero
        brand={data.brand}
        logo={data.logo}
        text={data.tagline}
        cta={data.upcoming.length > 0 ? data.labels.seeAllWorkshops : undefined}
      />
      <UpcomingWorkshops
        workshops={data.upcoming.slice(0, HOME_WORKSHOPS)}
        title={data.labels.upcomingTitle}
        allLabel={data.labels.allWorkshops}
        emptyTitle={data.labels.emptyTitle}
        emptyText={data.labels.emptyText}
      />
    </>
  )
}

export const defaultTheme: Theme = {
  id: "default",
  Frame,
  Home,
  About,
  WorkshopCard,
  themeColor: { light: "#fcfaf6", dark: "#101319" },
  fonts: themeDefaultFonts.default,
}
