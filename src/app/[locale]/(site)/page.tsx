import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { getHomeData } from "@/features/site/home"
import { pageLocale } from "@/i18n/page-locale"
import { alternates, jsonLdText, openGraphOf, siteOgImage } from "@/lib/seo"
import { getBrand, getSetting } from "@/lib/settings"
import { getActiveTheme } from "@/themes/registry"

/**
 * Title and description from the SEO setting in the page's own language (a
 * missing one falls back to the brand and a default sentence, never to
 * another language's text).
 */
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const locale = pageLocale((await params).locale)
  const [t, brand, seo, links] = await Promise.all([
    getTranslations({ locale, namespace: "site.home" }),
    getBrand(locale),
    getSetting("seo"),
    alternates("/", locale),
  ])
  const title = seo.title[locale as keyof typeof seo.title] || `${t("metaTitle")} · ${brand}`
  const description = seo.description[locale as keyof typeof seo.description] || t("metaDescription", { brand })
  return {
    title: { absolute: title },
    description,
    alternates: links,
    openGraph: { type: "website", title, description, siteName: brand, ...openGraphOf(locale, links.canonical) },
  }
}

/**
 * The home page ("/" in the main language, "/fa", "/en"): the active theme's
 * sections (src/themes) with the home page's content (src/features/site/home.ts).
 */
export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const locale = pageLocale((await params).locale)
  const [{ theme }, data, brand, home, links] = await Promise.all([
    getActiveTheme(),
    getHomeData(locale),
    getBrand(locale),
    getSetting("home"),
    alternates("/", locale),
  ])
  // Who runs the site and what it is, for search engines: one organisation (at the main language's address), one site per language.
  const organization = `${links.languages["x-default"]}#organization`
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organization,
        name: brand,
        url: links.languages["x-default"],
        logo: siteOgImage().url,
        ...(home.footer.instagram ? { sameAs: [home.footer.instagram] } : {}),
      },
      { "@type": "WebSite", "@id": `${links.canonical}#website`, name: brand, url: links.canonical, inLanguage: locale, publisher: { "@id": organization } },
    ],
  }
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />
      <theme.Home data={data} />
    </>
  )
}
