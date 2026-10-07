import { CalendarHeartIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { listMyWorkshops } from "@/features/instructor-panel/queries"
import { getBrand } from "@/lib/settings"
import { PageTitle, Section, WorkshopCard } from "../_components/parts"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instructorPanel.workshops")
  return { title: t("metaTitle") }
}

/** My workshops: upcoming first (soonest on top), then the past ones. */
export default async function MyWorkshopsPage({ params }: PageProps<"/[locale]/instructor/workshops">) {
  const { locale } = await params
  const [{ upcoming, past }, t, brand] = await Promise.all([
    listMyWorkshops(),
    getTranslations("instructorPanel.workshops"),
    getBrand(locale),
  ])

  return (
    <>
      <PageTitle title={t("title")} subtitle={t("subtitle")} />
      {upcoming.length || past.length ? (
        <div className="space-y-10">
          <Section title={t("upcoming")}>
            {upcoming.length ? (
              <ul className="grid gap-3">
                {upcoming.map((w) => (
                  <li key={w.id}>
                    <WorkshopCard workshop={w} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t("noUpcoming")}</p>
            )}
          </Section>
          {past.length > 0 && (
            <Section title={t("past")}>
              <ul className="grid gap-3">
                {past.map((w) => (
                  <li key={w.id}>
                    <WorkshopCard workshop={w} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      ) : (
        <EmptyState icon={CalendarHeartIcon} title={t("emptyTitle")} description={t("emptyText", { brand })} />
      )}
    </>
  )
}
