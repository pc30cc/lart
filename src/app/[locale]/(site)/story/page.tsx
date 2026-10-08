import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { getAboutData } from "@/features/site/about"
import { pageLocale } from "@/i18n/page-locale"
import { absoluteUrl, alternates, clipDescription, jsonLdText, openGraphOf } from "@/lib/seo"
import { getActiveTheme } from "@/themes/registry"

/**
 * "Our story · brand", with the site's picture (an upright portrait would be
 * cut to a wide card's middle). With no partner on it the page is nearly
 * empty: not indexed then (its links are followed), and out of the sitemap.
 */
export async function generateMetadata({ params }: PageProps<"/[locale]/story">): Promise<Metadata> {
  const locale = pageLocale((await params).locale)
  const [t, data, links] = await Promise.all([
    getTranslations({ locale, namespace: "about" }),
    getAboutData(locale, "story"),
    alternates("/story", locale),
  ])
  const description = clipDescription(data.intro)
  return {
    title: t("story.metaTitle"),
    description,
    ...(data.partners.length > 0 ? { alternates: links } : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "website",
      title: `${t("story.metaTitle")} · ${data.brand}`,
      description,
      siteName: data.brand,
      ...openGraphOf(locale, links.canonical),
    },
  }
}

/** The Our story page (/story): the partners who chose to be on it, in the active theme. */
export default async function StoryPage({ params }: PageProps<"/[locale]/story">) {
  const locale = pageLocale((await params).locale)
  const [{ theme }, data, links, home, t] = await Promise.all([
    getActiveTheme(),
    getAboutData(locale, "story"),
    alternates("/story", locale),
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
    name: `${t("story.metaTitle")} · ${data.brand}`,
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
              ...(p.bio ? { description: clipDescription(p.bio, 300) } : {}),
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
