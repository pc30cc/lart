import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { getAboutData } from "@/features/site/about"
import { pageLocale } from "@/i18n/page-locale"
import { absoluteUrl, alternates, jsonLdText, openGraphOf } from "@/lib/seo"
import { getBrand } from "@/lib/settings"
import { getActiveTheme } from "@/themes/registry"

const DESCRIPTION_MAX = 160

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`

/**
 * "About us · brand", described by the brand's own sentences in this
 * language, with the site's picture. With no partner on it
 * the page only repeats the footer's text: not indexed then (its links are
 * followed), and out of the sitemap.
 */
export async function generateMetadata({ params }: PageProps<"/[locale]/about">): Promise<Metadata> {
  const locale = pageLocale((await params).locale)
  const [t, brand, data, links] = await Promise.all([
    getTranslations({ locale, namespace: "about" }),
    getBrand(locale),
    getAboutData(locale),
    alternates("/about", locale),
  ])
  const description = clip(data.intro.replace(/\s+/g, " "), DESCRIPTION_MAX)
  const indexed = data.partners.length > 0
  return {
    title: t("metaTitle"),
    description,
    ...(indexed ? { alternates: links } : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "website",
      title: `${t("metaTitle")} · ${brand}`,
      description,
      siteName: brand,
      // The site's picture: an upright portrait would be cut to a wide card's middle.
      ...openGraphOf(locale, links.canonical),
    },
  }
}

/** The About page (/about): the brand's story and the partners who chose to be on it, in the active theme. */
export default async function AboutPage({ params }: PageProps<"/[locale]/about">) {
  const locale = pageLocale((await params).locale)
  const [{ theme }, data, links, home, t] = await Promise.all([
    getActiveTheme(),
    getAboutData(locale),
    alternates("/about", locale),
    alternates("/", locale),
    getTranslations({ locale, namespace: "about" }),
  ])
  // The same organisation as the home page's JSON-LD: at the main language's home address.
  const organization = home.languages["x-default"]
  // The page, and the people behind the brand, for search engines: each person's words in this page's language only.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": `${links.canonical}#page`,
    url: links.canonical,
    name: `${t("metaTitle")} · ${data.brand}`,
    inLanguage: locale,
    description: data.intro,
    mainEntity: {
      "@type": "Organization",
      "@id": `${organization}#organization`,
      name: data.brand,
      url: organization,
      ...(data.partners.length
        ? {
            member: data.partners.map((p) => ({
              "@type": "Person",
              name: p.name,
              ...(p.role ? { jobTitle: p.role } : {}),
              ...(p.bio ? { description: clip(p.bio.replace(/\s+/g, " "), 300) } : {}),
              ...(p.portraitUrl ? { image: absoluteUrl(p.portraitUrl) } : {}),
            })),
          }
        : {}),
    },
  }
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />
      <theme.About data={data} />
    </>
  )
}
