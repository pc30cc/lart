import { SparklesIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { listOpenWorkshops } from "@/features/registrations/public"
import { alternates, ogLocale } from "@/lib/seo"
import { getBrand } from "@/lib/settings"
import { WorkshopCard } from "./_components/workshop-card"

export async function generateMetadata({ params }: PageProps<"/[locale]/workshops">): Promise<Metadata> {
  const { locale } = await params
  const [t, brand] = await Promise.all([getTranslations({ locale, namespace: "registration.list" }), getBrand(locale)])
  const description = t("metaDescription", { brand })
  return {
    title: t("metaTitle"),
    description,
    alternates: await alternates("/workshops", locale),
    openGraph: { type: "website", title: `${t("metaTitle")} · ${brand}`, description, siteName: brand, locale: ogLocale[locale] },
  }
}

/** The upcoming workshops, soonest first. Phase 3 themes restyle it with the same data. */
export default async function WorkshopsPage({ params }: PageProps<"/[locale]/workshops">) {
  const { locale } = await params
  const [t, workshops] = await Promise.all([getTranslations("registration.list"), listOpenWorkshops(locale)])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <header className="mb-8 max-w-2xl space-y-2 sm:mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl rtl:tracking-normal">{t("title")}</h1>
        <p className="text-muted-foreground text-base text-pretty sm:text-lg">{t("subtitle")}</p>
      </header>

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
