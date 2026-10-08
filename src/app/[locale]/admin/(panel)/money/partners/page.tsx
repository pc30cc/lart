import { CircleAlertIcon, HandshakeIcon, LockIcon, ScrollTextIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { PageHeader } from "@/components/admin/page-header"
import { PersonAvatar } from "@/components/admin/person-avatar"
import { StatusBadge } from "@/components/admin/status-badge"
import { getMoneyRules, listPartnerAccounts, type PartnerAccount } from "@/features/money/queries"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatPercent, localized } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ContributionDialog, WithdrawalDialog } from "../_components/dialogs"
import { Row } from "../_components/parts"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("money.partners")
  return { title: t("title") }
}

/**
 * The two partners: each one's capital, step by step (what they put in, took
 * out and earned from closed workshops), their part of what is not shared
 * out yet, and what they would get if the business settled today. The shares
 * are fixed (Settings → Money shows them); capital goes in from both at once.
 */
export default async function PartnersPage() {
  await requireAdmin()
  const [t, locale, data, rules] = await Promise.all([
    getTranslations("money.partners"),
    getLocale(),
    listPartnerAccounts(),
    getMoneyRules(),
  ])
  const active = data.rows.filter((p) => p.active)
  const sharing = active.filter((p) => p.shareBp > 0).map((p) => ({ adminId: p.id, name: p.name }))

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          sharing.length > 0 && (
            <>
              <ContributionDialog partners={sharing} trigger={{ variant: "default" }} />
              {rules.withdrawals && <WithdrawalDialog partners={sharing} />}
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
        <div className="grid gap-4 md:grid-cols-2">
          {data.rows.map((p) => (
            <PartnerCard key={p.id} partner={p} locale={locale} t={t} sharesOk={data.sharesOk} withdrawals={rules.withdrawals} />
          ))}
        </div>
      )}

      <p className="mt-6">
        <Link
          href="/admin/money/reports?report=partner"
          className="text-primary inline-flex items-center gap-2 text-sm font-medium underline-offset-3 hover:underline"
        >
          <ScrollTextIcon className="size-4" aria-hidden />
          {t("explain.statement")}
        </Link>
      </p>
    </>
  )
}

/** Closed workshops listed on a card; the full statement has the rest. */
const WORKSHOPS_SHOWN = 5

function PartnerCard({
  partner: p,
  locale,
  t,
  sharesOk,
  withdrawals,
}: {
  partner: PartnerAccount
  locale: string
  t: Awaited<ReturnType<typeof getTranslations<"money.partners">>>
  sharesOk: boolean
  /** Whether withdrawals are open (Settings → Money). */
  withdrawals: boolean
}) {
  const shown = p.workshops.slice(0, WORKSHOPS_SHOWN)
  return (
    <article className={cn("bg-card ring-foreground/8 flex flex-col rounded-xl shadow-xs ring-1", !p.active && "opacity-80")}>
      <header className="flex items-start gap-3 border-b p-4 md:p-5">
        <PersonAvatar name={p.name} url={p.photoUrl} className="size-12 text-base font-semibold" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{p.name}</h2>
          <p className="text-muted-foreground truncate text-xs rtl:text-right" dir="ltr">
            {p.email}
          </p>
        </div>
        <div className="text-end">
          {p.active ? (
            <>
              <div className="text-2xl font-semibold tracking-tight tabular-nums">{formatPercent(p.shareBp / 10000, locale, 2)}</div>
              <div className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <LockIcon className="size-3" aria-hidden />
                {t("card.share")}
              </div>
            </>
          ) : (
            <StatusBadge>{t("card.inactive")}</StatusBadge>
          )}
        </div>
      </header>

      <div className="flex-1 p-4 text-sm md:p-5">
        <h3 className="text-muted-foreground mb-1 text-xs font-medium">{t("card.capitalTitle")}</h3>
        <Row label={t("card.contributions")} value={p.contributions} hint={t("card.contributionsHint")} />
        <Row label={t("card.withdrawals")} value={p.withdrawals} tone="negative" hint={t("card.withdrawalsHint")} />
        <Row label={t("card.profitShares")} value={p.profitShares} tone="signed" hint={t("card.profitSharesHint")} />
        <Row label={t("card.capital")} value={p.capital} strong />
      </div>

      <section className="border-t p-4 text-sm md:p-5">
        <h3 className="text-muted-foreground mb-1 text-xs font-medium">{t("card.workshopsTitle")}</h3>
        {shown.length === 0 ? (
          <p className="text-muted-foreground py-1.5 text-xs">{t("card.noWorkshops")}</p>
        ) : (
          <ul className="divide-y">
            {shown.map((w) => (
              <li key={w.courseId} className="flex items-baseline justify-between gap-4 py-2">
                <span className="min-w-0">
                  <Link
                    href={`/admin/workshops/${w.courseId}/finances`}
                    className="hover:text-primary block truncate font-medium transition-colors"
                  >
                    {localized(w.title, locale)}
                  </Link>
                  <span className="text-muted-foreground block text-xs">
                    {t("card.closedOn", { date: formatDate(`${w.closedOn}T09:00:00Z`, locale, "medium") })}
                  </span>
                </span>
                <Money value={w.amount} tone="signed" />
              </li>
            ))}
          </ul>
        )}
        {p.workshops.length > shown.length && (
          <p className="text-muted-foreground pt-1 text-xs">{t("card.moreWorkshops", { count: p.workshops.length - shown.length })}</p>
        )}
        <div className="bg-primary/8 mt-3 flex items-baseline justify-between gap-4 rounded-lg px-3 py-2.5">
          <span className="min-w-0">
            <span className="font-semibold">{t("card.owed")}</span>
            <span className="text-muted-foreground block text-xs">{withdrawals ? t("card.owedHintOpen") : t("card.owedHintClosed")}</span>
          </span>
          <Money value={p.owed} className="text-base font-semibold" />
        </div>
      </section>

      {p.active && sharesOk && (
        <div className="bg-muted/40 border-t p-4 text-sm md:px-5">
          <Row label={t("card.openShare")} value={p.openShare} tone="signed" hint={t("card.openShareHint")} />
          <div className="flex items-baseline justify-between gap-4 border-t pt-3 font-semibold">
            <span>
              {t("card.equity")}
              <span className="text-muted-foreground block text-xs font-normal">{t("card.equityHint")}</span>
            </span>
            <Money value={p.equity} className="text-lg" />
          </div>
        </div>
      )}

      <footer className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t px-4 py-3 text-xs md:px-5">
        <span>
          {p.lastMovement
            ? t("card.lastMovement", { date: formatDate(`${p.lastMovement}T09:00:00Z`, locale, "medium") })
            : t("card.noMovement")}
        </span>
        <Link
          href={`/admin/money/reports?report=partner&partner=${p.id}`}
          className="text-primary font-medium underline-offset-3 hover:underline"
        >
          {t("card.statement")}
        </Link>
      </footer>
    </article>
  )
}
