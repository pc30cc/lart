import "server-only"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { pageLocale } from "@/i18n/page-locale"
import { alternates, openGraphOf } from "@/lib/seo"
import { LegalShell, LegalText } from "./components/legal-page"
import { getLegalPage } from "./data"
import type { LegalDoc } from "./texts"

type Props = { params: Promise<{ locale: string }> }

/**
 * The page and metadata of a legal text (/privacy, /distance-sales,
 * /cancellation): its title, a one-line description, the language links, and
 * the text filled in from Settings → Legal details.
 */
export function legalRoute(doc: LegalDoc, path: "/privacy" | "/distance-sales" | "/cancellation") {
  async function generateMetadata({ params }: Props): Promise<Metadata> {
    const locale = pageLocale((await params).locale)
    const [t, page, links] = await Promise.all([
      getTranslations({ locale, namespace: "legal" }),
      getLegalPage(doc, locale),
      alternates(path, locale),
    ])
    const description = t(`descriptions.${doc}`, { brand: page.brand })
    return {
      title: page.title,
      description,
      alternates: links,
      openGraph: { type: "website", title: `${page.title} · ${page.brand}`, description, siteName: page.brand, ...openGraphOf(locale, links.canonical) },
    }
  }

  async function LegalPage({ params }: Props) {
    const locale = pageLocale((await params).locale)
    const page = await getLegalPage(doc, locale)
    return (
      <LegalShell current={path}>
        <LegalText text={page.text} />
      </LegalShell>
    )
  }

  return { generateMetadata, LegalPage }
}
