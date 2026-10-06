import { CircleAlertIcon, HandshakeIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge } from "@/components/admin/status-badge"
import { listPartnerAccounts, type PartnerAccount } from "@/features/money/queries"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"
import { CapitalDialog } from "../_components/dialogs"
import { Panel, Row } from "../_components/parts"
import { SharesForm } from "../_components/shares-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("money.partners")
  return { title: t("title") }
}

export default async function PartnersPage() {
  await requireAdmin()
  const [t, locale, data] = await Promise.all([getTranslations("money.partners"), getLocale(), listPartnerAccounts()])
  const active = data.rows.filter((p) => p.active)
  const options = active.map((p) => ({ adminId: p.id, name: p.name }))

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          options.length > 0 && (
            <>
              <CapitalDialog direction="contribution" partners={options} trigger={{ variant: "default" }} />
              <CapitalDialog direction="withdrawal" partners={options} />
            </>
          )
        }
      />

      {!data.sharesOk && active.length > 0 && (
        <div role="alert" className="bg-warning/10 text-warning mb-6 flex items-start gap-3 rounded-xl p-4 text-sm">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="text-pretty">
            <span className="font-medium">{t("sharesWarning.title")}</span> {t("sharesWarning.description")}
          </p>
        </div>
      )}

      {data.rows.length === 0 ? (
        <EmptyState icon={HandshakeIcon} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.rows.map((p) => (
            <PartnerCard key={p.id} partner={p} locale={locale} t={t} sharesOk={data.sharesOk} />
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {active.length > 0 && (
          <Panel title={t("shares.title")} description={t("shares.description")}>
            <SharesForm partners={active.map((p) => ({ adminId: p.id, name: p.name, shareBp: p.shareBp }))} />
          </Panel>
        )}
        <Panel title={t("explain.title")}>
          <div className="text-muted-foreground space-y-3 text-sm text-pretty">
            <p>{t("explain.capital")}</p>
            <p>{t("explain.open")}</p>
            <div className="text-foreground">
              <Row label={t("explain.openLabel")} value={data.openResult} tone="signed" strong />
            </div>
            <p>{t("explain.settled")}</p>
            <p>
              <Link href="/admin/money/reports?report=partner" className="text-primary underline-offset-3 hover:underline">
                {t("explain.statement")}
              </Link>
            </p>
          </div>
        </Panel>
      </div>
    </>
  )
}

function PartnerCard({
  partner: p,
  locale,
  t,
  sharesOk,
}: {
  partner: PartnerAccount
  locale: string
  t: Awaited<ReturnType<typeof getTranslations<"money.partners">>>
  sharesOk: boolean
}) {
  return (
    <article className={cn("bg-card ring-foreground/8 flex flex-col rounded-xl shadow-xs ring-1", !p.active && "opacity-80")}>
      <header className="flex items-start gap-3 border-b p-4 md:p-5">
        <span aria-hidden className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-full text-base font-semibold">
          {p.name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{p.name}</h2>
          <p className="text-muted-foreground truncate text-xs rtl:text-right" dir="ltr">
            {p.email}
          </p>
        </div>
        <div className="text-end">
          {p.active ? (
            <>
              <div className="text-2xl font-semibold tracking-tight tabular-nums">{formatPercent(p.shareBp / 10000, locale, 2)}</div>
              <div className="text-muted-foreground text-xs">{t("card.share")}</div>
            </>
          ) : (
            <StatusBadge>{t("card.inactive")}</StatusBadge>
          )}
        </div>
      </header>
      <div className="flex-1 p-4 text-sm md:p-5">
        <Row label={t("card.contributions")} value={p.contributions} />
        <Row label={t("card.withdrawals")} value={p.withdrawals} tone="negative" />
        <Row label={t("card.paidForBusiness")} value={p.paidForBusiness} />
        <Row label={t("card.profitShares")} value={p.profitShares} tone="signed" />
        <Row label={t("card.capital")} value={p.capital} strong />
      </div>
      {p.active && sharesOk && (
        <footer className="bg-muted/40 space-y-1 rounded-b-xl border-t p-4 text-sm md:px-5">
          <Row label={t("card.openShare")} value={p.openShare} tone="signed" />
          <div className="flex items-baseline justify-between gap-4 pt-1 font-semibold">
            <span>{t("card.equity")}</span>
            <Money value={p.equity} />
          </div>
        </footer>
      )}
    </article>
  )
}
