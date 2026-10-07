import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { listOpenWorkshops } from "@/features/registrations/public"
import { alternates, ogLocale } from "@/lib/seo"
import { getBrand, getSetting } from "@/lib/settings"
import { HomeHero } from "./_components/home-hero"
import { UpcomingWorkshops } from "./_components/upcoming-workshops"

/** How many workshops the home page shows; the rest are one click away (/workshops). */
const HOME_WORKSHOPS = 6

/**
 * Title and description from the SEO setting in the page's own language (a
 * missing one falls back to the brand and a default sentence, never to
 * another language's text).
 */
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params
  const [t, brand, seo, links] = await Promise.all([
    getTranslations({ locale, namespace: "site.home" }),
    getBrand(locale),
    getSetting("seo"),
    alternates("/", locale),
  ])
  const title = seo.title[locale as keyof typeof seo.title] || brand
  const description = seo.description[locale as keyof typeof seo.description] || t("metaDescription", { brand })
  return {
    title: { absolute: title },
    description,
    alternates: links,
    openGraph: { type: "website", title, description, siteName: brand, locale: ogLocale[locale], url: links.canonical },
  }
}

/** The home page ("/" in the main language, "/fa", "/en"): the brand and the next workshops. */
export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params
  const [t, tl, brand, seo, workshops] = await Promise.all([
    getTranslations("site.home"),
    getTranslations("registration.list"),
    getBrand(locale),
    getSetting("seo"),
    listOpenWorkshops(locale, { limit: HOME_WORKSHOPS }),
  ])

  return (
    <>
      <HomeHero brand={brand} text={seo.description[locale as keyof typeof seo.description] || t("tagline")} cta={t("cta")} />
      <UpcomingWorkshops
        workshops={workshops}
        title={t("upcomingTitle")}
        allLabel={t("allWorkshops")}
        emptyTitle={tl("emptyTitle")}
        emptyText={tl("emptyText")}
      />
    </>
  )
}
