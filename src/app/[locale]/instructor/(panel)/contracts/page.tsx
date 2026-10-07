import { ChevronRightIcon, FileSignatureIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { StatusBadge } from "@/components/admin/status-badge"
import { listMyContracts } from "@/features/instructor-panel/queries"
import { Link } from "@/i18n/navigation"
import { formatDate, formatNumber, localized } from "@/lib/format"
import { getBrand } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { card, contractTone, PageTitle } from "../_components/parts"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instructorPanel.contracts")
  return { title: t("metaTitle") }
}

/** My contracts: every version sent to me, the ones to sign first. */
export default async function MyContractsPage({ params }: PageProps<"/[locale]/instructor/contracts">) {
  const { locale } = await params
  const [rows, t, brand] = await Promise.all([
    listMyContracts(),
    getTranslations("instructorPanel.contracts"),
    getBrand(locale),
  ])
  const contracts = [...rows.filter((c) => c.state === "toSign"), ...rows.filter((c) => c.state !== "toSign")]

  return (
    <>
      <PageTitle title={t("title")} subtitle={t("subtitle")} />
      {contracts.length ? (
        <ul className="grid gap-3">
          {contracts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/instructor/contracts/${c.id}`}
                className={cn(
                  card,
                  "group focus-visible:ring-ring/50 flex items-center gap-3 p-4 outline-none transition-shadow hover:shadow-md focus-visible:ring-3 sm:p-5",
                  c.state === "toSign" && "ring-warning/40",
                  (c.state === "replaced" || c.state === "closed") && "opacity-75",
                )}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                    <h2 className="min-w-0 text-base font-semibold text-pretty">{localized(c.title, locale)}</h2>
                    <StatusBadge tone={contractTone[c.state]}>{t(`state.${c.state}`)}</StatusBadge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {t("version", { version: formatNumber(c.version, locale) })}
                    <span aria-hidden> · </span>
                    {c.signedAt
                      ? t("signedOn", { date: formatDate(c.signedAt, locale, "long") })
                      : t("sentOn", { date: formatDate(c.sentAt, locale, "long") })}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {t("workshopOn", { date: formatDate(c.startsAt, locale, "full") })}
                  </p>
                </div>
                <ChevronRightIcon
                  className="text-muted-foreground/60 group-hover:text-foreground size-5 shrink-0 transition-colors rtl:rotate-180"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={FileSignatureIcon} title={t("emptyTitle")} description={t("emptyText", { brand })} />
      )}
    </>
  )
}
