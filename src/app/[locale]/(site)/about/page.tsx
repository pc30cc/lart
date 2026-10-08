import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { getAboutData } from "@/features/site/about"
import { pageLocale } from "@/i18n/page-locale"
import { alternates, clipDescription, jsonLdText, openGraphOf } from "@/lib/seo"
import { getActiveTheme } from "@/themes/registry"

/** "About us · brand", described by the brand's own sentences in this language, with the site's picture. */
export async function generateMetadata({ params }: PageProps<"/[locale]/about">): Promise<Metadata> {
  const locale = pageLocale((await params).locale)
  const [t, data, links] = await Promise.all([
    getTranslations({ locale, namespace: "about" }),
    getAboutData(locale, "about"),
    alternates("/about", locale),
  ])
  const description = clipDescription(data.intro)
  return {
    title: t("metaTitle"),
    description,
    alternates: links,
    openGraph: {
      type: "website",
      title: `${t("metaTitle")} · ${data.brand}`,
      description,
      siteName: data.brand,
      ...openGraphOf(locale, links.canonical),
    },
  }
}

/** The About page (/about): the brand's own words, in the active theme (the partners are on /story). */
export default async function AboutPage({ params }: PageProps<"/[locale]/about">) {
  const locale = pageLocale((await params).locale)
  const [{ theme }, data, links, home, t] = await Promise.all([
    getActiveTheme(),
    getAboutData(locale, "about"),
    alternates("/about", locale),
    alternates("/", locale),
    getTranslations({ locale, namespace: "about" }),
  ])
  // The same organisation as the home page's JSON-LD: at the main language's home address.
  const organization = home.languages["x-default"]
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": `${links.canonical}#page`,
    url: links.canonical,
    name: `${t("metaTitle")} · ${data.brand}`,
    inLanguage: locale,
    description: data.intro,
    mainEntity: { "@type": "Organization", "@id": `${organization}#organization`, name: data.brand, url: organization },
  }
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />
      <theme.About data={data} />
    </>
  )
}
