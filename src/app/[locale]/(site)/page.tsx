import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { getHomeData } from "@/features/site/home"
import { alternates, ogLocale } from "@/lib/seo"
import { getBrand, getSetting } from "@/lib/settings"
import { getActiveTheme } from "@/themes/registry"

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

/**
 * The home page ("/" in the main language, "/fa", "/en"): the active theme's
 * sections (src/themes) with the home page's content (src/features/site/home.ts).
 */
export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params
  const [{ theme }, data] = await Promise.all([getActiveTheme(), getHomeData(locale)])
  return <theme.Home data={data} />
}
