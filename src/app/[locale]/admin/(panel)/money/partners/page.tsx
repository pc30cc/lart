import { CircleAlertIcon, HandshakeIcon, InfoIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { PageHeader } from "@/components/admin/page-header"
import { PersonAvatar } from "@/components/admin/person-avatar"
import { StatusBadge } from "@/components/admin/status-badge"
import { getMoneyRules, listPartnerAccounts, type PartnerAccount } from "@/features/money/queries"
import { listPartnerInvites } from "@/features/partners/queries"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"
import { CapitalDialog } from "../_components/dialogs"
import { Panel, Row } from "../_components/parts"
import { SharesForm } from "../_components/shares-form"
import { InviteCard } from "./_components/invite-card"
import { InviteDialog } from "./_components/invite-dialog"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("money.partners")
  return { title: t("title") }
}

export default async function PartnersPage() {
  await requireAdmin()
  const [t, tp, locale, data, { invites, slots }] = await Promise.all([
    getTranslations("money.partners"),
    getTranslations("partners"),
    getLocale(),
    listPartnerAccounts(),
    listPartnerInvites(),
  ])
  const { withdrawals } = await getMoneyRules()
  const active = data.rows.filter((p) => p.active)
  const options = active.map((p) => ({ adminId: p.id, name: p.name }))
  // New partners join at 0 %; when the others already make 100 % nothing else would point it out.
  const zeroShare = data.sharesOk && active.some((p) => p.shareBp === 0)

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <InviteDialog disabled={!slots.canInvite} />
            {options.length > 0 && (
              <>
                <CapitalDialog direction="contribution" partners={options} trigger={{ variant: "default" }} />
                {withdrawals && <CapitalDialog direction="withdrawal" partners={options} />}
              </>
            )}
          </>
        }
      />

      {/* With no working invitation the team itself is full: nothing to cancel, so no such advice. */}
      {!slots.canInvite && <Note>{tp("invite.full", { max: slots.max, invited: slots.invited })}</Note>}

      {!data.sharesOk && active.length > 0 && (
        <div role="alert" className="bg-warning/10 text-warning mb-6 flex items-start gap-3 rounded-xl p-4 text-sm">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="text-pretty">
            <span className="font-medium">{t("sharesWarning.title")}</span> {t("sharesWarning.description")}
          </p>
        </div>
      )}

      {zeroShare && <Note>{tp("zeroShare")}</Note>}

      {data.rows.length === 0 && invites.length === 0 ? (
        <EmptyState icon={HandshakeIcon} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.rows.map((p) => (
            <PartnerCard key={p.id} partner={p} locale={locale} t={t} sharesOk={data.sharesOk} />
          ))}
          {invites.map((invite) => (
            <InviteCard key={invite.id} invite={invite} />
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {active.length > 0 && (
          <Panel title={t("shares.title")} description={t("shares.description")}>
            <SharesForm
              partners={active.map((p) => ({ adminId: p.id, name: p.name, shareBp: p.shareBp, photoUrl: p.photoUrl }))}
            />
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

/** A calm hint line (not a warning). */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div role="note" className="bg-info/8 text-foreground mb-6 flex items-start gap-3 rounded-xl p-4 text-sm">
      <InfoIcon className="text-info mt-0.5 size-4 shrink-0" />
      <p className="text-pretty">{children}</p>
    </div>
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
        <PersonAvatar name={p.name} url={p.photoUrl} className="size-11 text-base font-semibold" />
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
