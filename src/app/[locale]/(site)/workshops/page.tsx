import { SparklesIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { listOpenWorkshops } from "@/features/registrations/public"
import { categoryParam, listPublicCategories } from "@/features/site/public"
import { pageLocale } from "@/i18n/page-locale"
import { alternates, openGraphOf } from "@/lib/seo"
import { getBrand } from "@/lib/settings"
import { getActiveTheme } from "@/themes/registry"
import { CategoryFilter } from "./_components/category-filter"

/**
 * One address for search engines: a filtered view (?category=) is not
 * indexed, and has no canonical or language links (Google reads noindex and
 * a canonical to another page as contradicting each other); its links are followed.
 */
export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/workshops">): Promise<Metadata> {
  const [{ locale: raw }, query] = await Promise.all([params, searchParams])
  const locale = pageLocale(raw)
  const [t, brand, links] = await Promise.all([
    getTranslations({ locale, namespace: "registration.list" }),
    getBrand(locale),
    alternates("/workshops", locale),
  ])
  const description = t("metaDescription", { brand })
  const filtered = query.category !== undefined
  return {
    title: t("metaTitle"),
    description,
    ...(filtered ? { robots: { index: false, follow: true } } : { alternates: links }),
    openGraph: { type: "website", title: `${t("metaTitle")} · ${brand}`, description, siteName: brand, ...openGraphOf(locale, links.canonical) },
  }
}

/**
 * The upcoming workshops, soonest first, as the active theme's cards, with a
 * craft filter (`?category=<slug>`) when there is more than one craft. A
 * category that is unknown or has no open workshop shows the whole list.
 */
export default async function WorkshopsPage({ params, searchParams }: PageProps<"/[locale]/workshops">) {
  const [{ locale: raw }, query] = await Promise.all([params, searchParams])
  const locale = pageLocale(raw)
  const wanted = categoryParam(query.category)
  const [t, categories, inCategory, { theme }] = await Promise.all([
    getTranslations("registration.list"),
    listPublicCategories(locale),
    wanted ? listOpenWorkshops(locale, { category: wanted }) : null,
    getActiveTheme(),
  ])
  const current = inCategory?.length ? (categories.find((c) => c.slug === wanted) ?? null) : null
  const workshops = current && inCategory ? inCategory : await listOpenWorkshops(locale)
  const WorkshopCard = theme.WorkshopCard

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <header className="mb-8 max-w-2xl space-y-2 sm:mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl rtl:tracking-normal">{t("title")}</h1>
        <p className="text-muted-foreground text-base text-pretty sm:text-lg">{t("subtitle")}</p>
      </header>

      {categories.length > 1 && (
        <CategoryFilter categories={categories} current={current?.slug ?? null} label={t("filterLabel")} allLabel={t("all")} />
      )}

      {workshops.length === 0 ? (
        <EmptyState icon={SparklesIcon} title={t("emptyTitle")} description={t("emptyText")} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {workshops.map((w, i) => (
            <WorkshopCard key={w.id} workshop={w} priority={i < 3} />
          ))}
        </div>
      )}
    </div>
  )
}
