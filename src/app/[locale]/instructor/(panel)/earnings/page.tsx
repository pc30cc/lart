import { InfoIcon, WalletIcon } from "lucide-react"
import type { Metadata } from "next"
import { useTranslations } from "next-intl"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { getMyEarnings, type WorkshopEarnings } from "@/features/instructor-panel/queries"
import { panelStatus } from "@/features/instructor-panel/schema"
import { Link } from "@/i18n/navigation"
import { formatDate, formatNumber, localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { getBrand } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { card, PageTitle, WorkshopStatus } from "../_components/parts"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instructorPanel.earnings")
  return { title: t("metaTitle") }
}

/** My earnings per workshop: the agreed fee, the advance, what I received and what is still to come. */
export default async function MyEarningsPage({ params }: PageProps<"/[locale]/instructor/earnings">) {
  const { locale } = await params
  const [{ workshops, total }, t, brand] = await Promise.all([
    getMyEarnings(),
    getTranslations("instructorPanel.earnings"),
    getBrand(locale),
  ])

  return (
    <>
      <PageTitle title={t("title")} subtitle={t("subtitle")} />
      {workshops.length ? (
        <div className="space-y-8">
          <div className="grid gap-3 sm:grid-cols-2">
            <Total label={t("total.owed")} value={total.owed} strong />
            <Total label={t("total.received")} value={total.received} />
          </div>
          <ul className="grid gap-4">
            {workshops.map((w) => (
              <li key={w.id}>
                <EarningsCard workshop={w} locale={locale} brand={brand} />
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground flex gap-2 text-sm text-pretty">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("footnote", { brand })}
          </p>
        </div>
      ) : (
        <EmptyState icon={WalletIcon} title={t("emptyTitle")} description={t("emptyText")} />
      )}
    </>
  )
}

function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn(card, "space-y-1 p-5", strong && "bg-primary/6 ring-primary/20")}>
      <p className="text-muted-foreground text-sm">{label}</p>
      <Money value={value} className={cn("block text-2xl font-semibold", strong && "text-primary")} />
    </div>
  )
}

function EarningsCard({ workshop: w, locale, brand }: { workshop: WorkshopEarnings; locale: string; brand: string }) {
  const t = useTranslations("instructorPanel.earnings")
  const status = panelStatus(w)
  const lira = (kurus: number) => formatLira(kurus, locale)

  return (
    <article className={cn(card, "space-y-4 p-5 sm:p-6")}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-base font-semibold text-pretty">
            <Link href={`/instructor/workshops/${w.id}`} className="hover:underline focus-visible:underline">
              {localized(w.title, locale)}
            </Link>
          </h2>
          <p className="text-muted-foreground text-sm">{formatDate(w.startsAt, locale, "full")}</p>
        </div>
        <WorkshopStatus status={status} />
      </header>

      <dl className="divide-y text-sm">
        <Row label={t("fee")}>
          <Money value={w.fee} />
          <span className="text-muted-foreground block text-xs">
            {status === "cancelled"
              ? t("feeCancelled")
              : w.feeType === "fixed"
                ? t("feeFixed")
                : t("feePerParticipant", { rate: lira(w.feeAmount), count: formatNumber(w.participants, locale) })}
          </span>
        </Row>
        <Row label={t("advance")}>
          <Money value={w.advancePaid} />
          {w.advanceForCosts > 0 && (
            <span className="text-muted-foreground block text-xs">{t("advanceForCosts", { amount: lira(w.advanceForCosts) })}</span>
          )}
        </Row>
        <Row label={t("received")}>
          <Money value={w.received} />
        </Row>
        <Row label={t("owed")} strong>
          <Money value={w.owed} className={cn("font-semibold", w.owed > 0 && "text-primary")} />
        </Row>
      </dl>

      {w.toReturn > 0 && (
        <p className="bg-warning/10 rounded-xl p-3 text-sm text-pretty">{t("toReturn", { amount: lira(w.toReturn), brand })}</p>
      )}
      {!w.signed && status === "toSign" && <p className="text-muted-foreground text-xs text-pretty">{t("notSigned")}</p>}
      {w.estimate && <p className="text-muted-foreground text-xs text-pretty">{t("estimate")}</p>}
      {w.closed && w.owed === 0 && w.toReturn === 0 && w.fee > 0 && (
        <p className="text-success text-sm font-medium">{t("settled")}</p>
      )}
    </article>
  )
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className={cn("text-muted-foreground", strong && "text-foreground font-medium")}>{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  )
}
