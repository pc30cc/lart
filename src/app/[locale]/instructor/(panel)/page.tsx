import { CalendarHeartIcon, FileSignatureIcon, PenLineIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { Button } from "@/components/ui/button"
import { listContractsToSign, listMyWorkshops } from "@/features/instructor-panel/queries"
import { profileText } from "@/features/instructors/schema"
import { Link } from "@/i18n/navigation"
import { requireInstructor } from "@/lib/auth/instructor"
import { formatDate, formatTimeRange, localized } from "@/lib/format"
import { getBrand } from "@/lib/settings"
import { PageTitle, Section, WorkshopCard } from "./_components/parts"

const SHOWN = 4

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instructorPanel.home")
  return { title: t("metaTitle") }
}

/** Home: a warm hello, contracts to sign first, then the next workshops. */
export default async function InstructorHomePage({ params }: PageProps<"/[locale]/instructor">) {
  const { locale } = await params
  const [{ instructor }, toSign, { upcoming }, t, brand] = await Promise.all([
    requireInstructor(),
    listContractsToSign(),
    listMyWorkshops(),
    getTranslations("instructorPanel.home"),
    getBrand(locale),
  ])
  const name = profileText(instructor.displayName, locale).split(/\s+/)[0]

  return (
    <div className="space-y-10">
      <PageTitle title={name ? t("hello", { name }) : t("helloNoName")} subtitle={t("intro")} />

      {toSign.length > 0 && (
        <section
          aria-labelledby="to-sign"
          className="bg-primary/6 ring-primary/20 animate-in fade-in-0 space-y-5 rounded-2xl p-5 ring-1 sm:p-6"
        >
          <div className="flex items-start gap-3.5">
            <span className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-2xl">
              <FileSignatureIcon className="size-5.5" aria-hidden />
            </span>
            <div className="space-y-1">
              <h2 id="to-sign" className="text-lg font-semibold text-balance">
                {t("toSign.title", { count: toSign.length })}
              </h2>
              <p className="text-muted-foreground text-pretty">{t("toSign.text")}</p>
            </div>
          </div>
          <ul className="space-y-3">
            {toSign.map((contract) => (
              <li
                key={contract.id}
                className="bg-background/80 flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium text-pretty">{localized(contract.title, locale)}</p>
                  <p className="text-muted-foreground text-sm">
                    {formatDate(contract.startsAt, locale, "full")}
                    <span aria-hidden> · </span>
                    <bdi>{formatTimeRange(contract.startsAt, contract.endsAt, locale)}</bdi>
                  </p>
                </div>
                <Button asChild className="h-12 shrink-0 rounded-xl px-5 text-base">
                  <Link href={`/instructor/contracts/${contract.id}`}>
                    <PenLineIcon className="size-5" />
                    {t("toSign.button")}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section
        title={t("upcoming.title")}
        action={
          upcoming.length > SHOWN && (
            <Button asChild variant="ghost" className="h-10 px-3">
              <Link href="/instructor/workshops">{t("upcoming.all")}</Link>
            </Button>
          )
        }
      >
        {upcoming.length ? (
          <ul className="grid gap-3">
            {upcoming.slice(0, SHOWN).map((workshop) => (
              <li key={workshop.id}>
                <WorkshopCard workshop={workshop} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={CalendarHeartIcon}
            title={t("upcoming.emptyTitle")}
            description={t("upcoming.emptyText", { brand })}
          />
        )}
      </Section>
    </div>
  )
}
