import {
  ArrowRightIcon,
  HandCoinsIcon,
  HourglassIcon,
  LockIcon,
  PiggyBankIcon,
  ScrollTextIcon,
  WalletIcon,
} from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import type { Entry } from "@/features/money/queries"
import { getMoneyRules, getWalletOverview, spendBlockText } from "@/features/money/queries"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, localized } from "@/lib/format"
import { cn } from "@/lib/utils"
import { WorkshopStatusBadge } from "../workshops/_components/workshop-status"
import { CapitalDialog, ExpenseDialog } from "./_components/dialogs"
import { kindIcons, Panel, Stat } from "./_components/parts"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("money.wallet")
  return { title: t("title") }
}

export default async function WalletPage() {
  await requireAdmin()
  const [t, locale, data, rules] = await Promise.all([getTranslations("money"), getLocale(), getWalletOverview(), getMoneyRules()])
  const partners = data.partners.map((p) => ({ adminId: p.adminId, name: p.name }))
  const { balances } = data
  const empty = data.recent.length === 0

  return (
    <>
      <PageHeader
        title={t("wallet.title")}
        description={t("wallet.description")}
        actions={
          partners.length > 0 && (
            <>
              <CapitalDialog direction="contribution" partners={partners} trigger={{ variant: "default" }} />
              {rules.withdrawals && <CapitalDialog direction="withdrawal" partners={partners} />}
              <ExpenseDialog blocked={spendBlockText(rules, t)} />
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)]">
        <div className="from-primary/12 to-primary/3 ring-primary/15 relative flex flex-col justify-between gap-6 overflow-hidden rounded-2xl bg-linear-to-br p-5 shadow-xs ring-1 md:p-6">
          <WalletIcon aria-hidden className="text-primary/10 absolute -end-6 -bottom-8 size-40 rtl:-scale-x-100" />
          <div className="flex items-center gap-2">
            <span className="bg-primary/15 text-primary flex size-9 items-center justify-center rounded-xl">
              <WalletIcon className="size-5" />
            </span>
            <span className="text-sm font-medium">{t("wallet.balance")}</span>
          </div>
          <div className="relative space-y-1">
            <Money
              value={balances.wallet}
              className={cn("block text-4xl font-semibold tracking-tight md:text-5xl", balances.wallet < 0 && "text-destructive")}
            />
            <p className="text-muted-foreground text-sm text-pretty">
              {balances.wallet < 0 ? t("wallet.negative") : t("wallet.balanceHint")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            icon={HandCoinsIcon}
            label={t("wallet.advances")}
            value={<Money value={balances.instructor_advance} />}
            hint={t("wallet.advancesHint")}
          />
          <Stat
            icon={HourglassIcon}
            tone={balances.instructor_payable > 0 ? "warning" : "neutral"}
            label={t("wallet.owed")}
            value={<Money value={balances.instructor_payable} />}
            hint={t("wallet.owedHint")}
          />
          <Stat
            icon={PiggyBankIcon}
            tone="brand"
            label={t("wallet.open")}
            value={<Money value={data.openResult} tone="signed" />}
            hint={t("wallet.openHint")}
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel
          title={t("wallet.recent")}
          actions={
            !empty && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/money/transactions">
                  {t("wallet.allTransactions")}
                  <ArrowRightIcon className="rtl:rotate-180" />
                </Link>
              </Button>
            )
          }
        >
          {empty ? (
            <EmptyState
              icon={ScrollTextIcon}
              title={t("wallet.empty.title")}
              description={t("wallet.empty.description")}
              className="border-0 bg-transparent py-8"
            />
          ) : (
            <ul className="-my-2 divide-y">
              {data.recent.map((entry) => (
                <RecentEntry key={entry.id} entry={entry} locale={locale} t={t} />
              ))}
            </ul>
          )}
        </Panel>

        <aside className="min-w-0 space-y-6">
          <Panel title={t("wallet.toClose.title")} description={t("wallet.toClose.description")}>
            {data.toClose.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("wallet.toClose.none")}</p>
            ) : (
              <ul className="-my-1.5 divide-y">
                {data.toClose.map((w) => (
                  <li key={w.id}>
                    <Link
                      href={`/admin/workshops/${w.id}/finances`}
                      className="group flex items-center gap-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="group-hover:text-primary block truncate text-sm font-medium transition-colors">
                          {localized(w.title, locale)}
                        </span>
                        <span className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
                          <WorkshopStatusBadge status={w.status} className="h-5 px-2" />
                          {formatDate(w.endsAt, locale, "medium")}
                        </span>
                      </span>
                      <LockIcon className="text-muted-foreground group-hover:text-primary size-4 shrink-0 transition-colors" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {data.withInstructors.length > 0 && (
            <Panel title={t("wallet.instructors.title")} description={t("wallet.instructors.description")}>
              <ul className="-my-1.5 divide-y">
                {data.withInstructors.map((row) => (
                  <li key={row.courseId}>
                    <Link href={`/admin/workshops/${row.courseId}/finances`} className="group block py-2.5">
                      <span className="group-hover:text-primary block truncate text-sm font-medium transition-colors">
                        {localized(row.instructor, locale)}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">{localized(row.title, locale)}</span>
                      <span className="mt-1 flex flex-wrap gap-x-3 text-xs">
                        {row.advance !== 0 && (
                          <span>
                            {t("wallet.instructors.holds")} <Money value={row.advance} className="font-medium" />
                          </span>
                        )}
                        {row.owed !== 0 && (
                          <span className="text-warning">
                            {t("wallet.instructors.owed")} <Money value={row.owed} className="font-medium" />
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </>
  )
}

function RecentEntry({
  entry,
  locale,
  t,
}: {
  entry: Entry
  locale: string
  t: Awaited<ReturnType<typeof getTranslations<"money">>>
}) {
  const Icon = kindIcons[entry.originalKind ?? entry.kind]
  const label = entry.originalKind
    ? t("kinds.reversalOf", { kind: t(`kinds.${entry.originalKind}`) })
    : t(`kinds.${entry.kind}`)
  const detail = [entry.description, entry.courseTitle && localized(entry.courseTitle, locale)].filter(Boolean).join(" · ")
  const partner = entry.lines.find((l) => l.partnerName)?.partnerName
  return (
    <li className={cn("flex items-center gap-3 py-3", entry.reversedBy && "opacity-60")}>
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4",
          entry.walletChange > 0 ? "bg-success/10 text-success" : entry.walletChange < 0 ? "bg-muted text-foreground" : "bg-primary/10 text-primary",
        )}
      >
        <Icon />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", entry.reversedBy && "line-through decoration-1")}>
          {label}
          {partner && <span className="text-muted-foreground font-normal"> · {partner}</span>}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {formatDate(`${entry.occurredOn}T09:00:00Z`, locale, "medium")}
          {detail && ` · ${detail}`}
        </p>
      </div>
      <Money
        value={entry.walletChange !== 0 ? entry.walletChange : entry.amount}
        tone={entry.walletChange !== 0 ? "signed" : "plain"}
        className="shrink-0 text-sm font-semibold"
      />
    </li>
  )
}
