import {
  CoinsIcon,
  HandCoinsIcon,
  LockIcon,
  ReceiptTextIcon,
  TrendingUpIcon,
  UserRoundCheckIcon,
  UsersRoundIcon,
} from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { Money } from "@/components/admin/money"
import type { ClosedTotals } from "@/db/schema"
import { getWorkshopFinances, type WorkshopFinances } from "@/features/money/queries"
import { getWorkshop } from "@/features/workshops/queries"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDateTime, formatNumber, formatPercent, localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"
import { AdvanceDialog, ExpenseDialog, PayInstructorDialog } from "../../../money/_components/dialogs"
import { Panel, printCss, Row, Stat } from "../../../money/_components/parts"
import { PrintButton } from "../../../money/_components/print-button"
import { WorkshopHeader } from "../../_components/workshop-header"
import { CloseWorkshop } from "./_components/close-workshop"
import { EntryList } from "./_components/entry-list"

type T = Awaited<ReturnType<typeof getTranslations<"money">>>

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/workshops/[id]/finances">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [workshop, t, locale] = await Promise.all([getWorkshop(id), getTranslations("money.finances"), getLocale()])
  return workshop ? { title: t("metaTitle", { title: localized(workshop.title, locale) }) } : {}
}

export default async function WorkshopFinancesPage({ params }: PageProps<"/[locale]/admin/workshops/[id]/finances">) {
  await requireAdmin()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const [workshop, finances, t, locale] = await Promise.all([
    getWorkshop(id),
    getWorkshopFinances(id),
    getTranslations("money"),
    getLocale(),
  ])
  if (!workshop || !finances) notFound()

  const partners = finances.partners.map((p) => ({ adminId: p.adminId, name: p.name }))
  const instructor = localized(workshop.instructor.displayName, locale)
  const title = localized(workshop.title, locale)
  // Books locked: a cancelled workshop keeps its status once closed, so look at `closedAt`.
  const closed = finances.closedAt && finances.closedTotals
  const owed = finances.balances.payable

  return (
    <>
      <style>{printCss}</style>
      <WorkshopHeader
        workshop={workshop}
        active="finances"
        actions={
          closed ? (
            <>
              {owed > 0 && <PayInstructorDialog courseId={id} partners={partners} owed={owed} instructor={instructor} />}
              <PrintButton label={t("finances.print")} />
            </>
          ) : undefined
        }
      />
      <h1 className="mb-4 hidden text-xl font-semibold print:block">{title}</h1>
      {closed ? (
        <ClosedView finances={finances} totals={finances.closedTotals!} t={t} locale={locale} instructor={instructor} />
      ) : (
        <LiveView finances={finances} t={t} locale={locale} courseId={id} title={title} partners={partners} />
      )}
    </>
  )
}

/** How the instructor's fee is made up, in words. */
function feeText(finances: WorkshopFinances, t: T, locale: string, participants: number) {
  const c = finances.contract
  if (finances.status === "cancelled") return t("finances.fee.cancelled")
  if (!c) return t("finances.fee.noContract")
  if (c.feeType === "fixed") return t("finances.fee.fixed")
  return t("finances.fee.perParticipant", { count: formatNumber(participants, locale), amount: formatLira(c.feeAmount, locale) })
}

// ─── Before closing: live figures ─────────────────────────────────────────────

function LiveView({
  finances,
  t,
  locale,
  courseId,
  title,
  partners,
}: {
  finances: WorkshopFinances
  t: T
  locale: string
  courseId: string
  title: string
  partners: { adminId: string; name: string }[]
}) {
  const { balances, registrations: regs, projection, contract, status } = finances
  const cancelled = status === "cancelled"
  const finalNumber = status === "confirmed" || status === "closed"
  const expenses = finances.entries.filter((e) => e.kind === "expense")
  const advances = finances.entries.filter((e) => e.kind === "instructor_advance")
  // Not closable yet (still running): that is the only thing worth saying.
  const waiting = finances.issues.find((i) => i === "notClosable" || i === "notEnded")
  const issues = waiting ? [waiting] : finances.issues.filter((i) => i !== "closed")
  const agreedAdvance = contract?.advanceAmount ?? 0
  // Paid to the current instructor: an earlier instructor's advances (before this one's contract) don't count.
  const since = finances.contractSince
  const advancePaidSoFar = advances
    .filter((e) => !e.reversedBy && e.direction === "paid" && (!since || e.createdAt >= since))
    .reduce((s, e) => s + e.amount, 0)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          icon={UsersRoundIcon}
          label={t("finances.registrations")}
          value={formatNumber(regs.confirmed + regs.pending, locale)}
          hint={
            <>
              {/* A free workshop's registrations are confirmed straight away, with nothing paid. */}
              {regs.confirmed > 0 && regs.paid === 0 && regs.pending === 0
                ? t("finances.registrationsFree")
                : t("finances.registrationsPaid", { count: regs.paid, pending: regs.pending })}
              {finalNumber && projection.participants !== regs.confirmed + regs.pending && (
                <span className="block">{t("finances.finalNumber", { count: formatNumber(projection.participants, locale) })}</span>
              )}
            </>
          }
        />
        <Stat
          icon={CoinsIcon}
          label={t("columns.revenue")}
          value={<Money value={projection.revenue} />}
          hint={
            balances.revenue === projection.revenue
              ? t("finances.revenueHint")
              : t("finances.revenueInBooks", { amount: formatLira(balances.revenue, locale) })
          }
        />
        <Stat
          icon={UserRoundCheckIcon}
          label={finalNumber || cancelled ? t("columns.instructorFees") : t("finances.feeEstimate")}
          value={<Money value={projection.instructorFee} />}
          hint={feeText(finances, t, locale, projection.participants)}
        />
        <Stat
          icon={ReceiptTextIcon}
          label={t("columns.courseExpenses")}
          value={<Money value={projection.expenses} />}
          hint={t("finances.expensesCount", { count: expenses.filter((e) => !e.reversedBy).length })}
        />
        <Stat
          icon={HandCoinsIcon}
          label={t("finances.advanceHeld")}
          value={<Money value={balances.advance} />}
          hint={agreedAdvance > 0 ? t("finances.advanceAgreed", { amount: formatLira(agreedAdvance, locale) }) : t("finances.noAdvanceAgreed")}
        />
        <Stat
          icon={TrendingUpIcon}
          tone={projection.netProfit >= 0 ? "success" : "danger"}
          label={t("finances.projectedNet")}
          value={<Money value={projection.netProfit} tone="signed" />}
          hint={t("finances.projectedHint")}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel
            title={t("finances.expenses.title")}
            description={t("finances.expenses.description")}
            actions={<ExpenseDialog courseId={courseId} partners={partners} advance={balances.advance} trigger={{ size: "sm", variant: "outline", className: "px-3" }} />}
          >
            <EntryList entries={expenses} empty={t("finances.expenses.empty")} />
          </Panel>

          <Panel
            title={t("finances.advance.title")}
            description={t("finances.advance.description")}
            actions={
              <>
                {!cancelled && (
                  <AdvanceDialog
                    courseId={courseId}
                    direction="paid"
                    partners={partners}
                    held={balances.advance}
                    suggested={Math.max(0, agreedAdvance - advancePaidSoFar)}
                    trigger={{ size: "sm", variant: "outline", className: "px-3" }}
                  />
                )}
                {balances.advance > 0 && (
                  <AdvanceDialog
                    courseId={courseId}
                    direction="returned"
                    partners={partners}
                    held={balances.advance}
                    trigger={{ size: "sm", variant: "outline", className: "px-3" }}
                  />
                )}
              </>
            }
          >
            <EntryList entries={advances} empty={t("finances.advance.empty")} />
          </Panel>
        </div>

        <aside className="min-w-0 space-y-6">
          <Panel title={t("finances.split.title")} description={t("finances.split.description")}>
            {projection.partners.length ? (
              <ul className="space-y-3">
                {projection.partners.map((p) => (
                  <li key={p.adminId} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        {p.name} <span className="text-muted-foreground">· {formatPercent(p.shareBp / 10000, locale, 2)}</span>
                      </span>
                      <Money value={p.amount} tone="signed" className="font-semibold" />
                    </div>
                    <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
                      <div className="bg-primary h-full rounded-full" style={{ width: `${p.shareBp / 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-warning text-sm text-pretty">
                {t("close.issues.sharesNot100")}{" "}
                <Link href="/admin/money/partners" className="font-medium underline underline-offset-3">
                  {t("close.fixShares")}
                </Link>
              </p>
            )}
          </Panel>

          <Panel title={t("close.panelTitle")} description={t("close.panelDescription")}>
            <CloseWorkshop
              courseId={courseId}
              title={title}
              figures={finances.plan.figures}
              issues={issues}
              unpaid={regs.unpaid}
              feeText={feeText(finances, t, locale, finances.plan.figures.participants)}
            />
          </Panel>
        </aside>
      </div>
    </div>
  )
}

// ─── After closing: the locked figures ────────────────────────────────────────

function ClosedView({
  finances,
  totals,
  t,
  locale,
  instructor,
}: {
  finances: WorkshopFinances
  totals: ClosedTotals
  t: T
  locale: string
  instructor: string
}) {
  const payments = finances.entries.filter((e) => e.kind === "instructor_payment")
  const paid = payments.filter((e) => !e.reversedBy).reduce((s, e) => s + e.amount, 0)
  const owed = finances.balances.payable
  const advanceUsed = Math.max(0, totals.instructorFee - owed - paid)
  const others = finances.entries.filter((e) => e.kind !== "instructor_payment")

  return (
    <div className="space-y-6">
      <div className="bg-muted/50 flex items-start gap-3 rounded-xl p-4 text-sm">
        <LockIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <p className="text-pretty">
          <span className="font-medium">
            {t("finances.closed.title", { date: finances.closedAt ? formatDateTime(finances.closedAt, locale, "long") : "" })}
          </span>{" "}
          <span className="text-muted-foreground">{t("finances.closed.description")}</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("columns.revenue")} value={<Money value={totals.revenue} />} hint={t("finances.closed.participants", { count: totals.participants })} />
        <Stat label={t("columns.instructorFees")} value={<Money value={totals.instructorFee} />} />
        <Stat label={t("columns.courseExpenses")} value={<Money value={totals.expenses} />} />
        <Stat
          tone={totals.netProfit >= 0 ? "success" : "danger"}
          icon={TrendingUpIcon}
          label={t("columns.net")}
          value={<Money value={totals.netProfit} tone="signed" />}
          className="ring-primary/20"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title={totals.netProfit >= 0 ? t("close.profitTo") : t("close.lossTo")}>
            {totals.partners.length ? (
              <ul className="grid gap-3 sm:grid-cols-3">
                {totals.partners.map((p) => (
                  <li key={p.adminId} className="bg-muted/40 rounded-xl p-4">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-muted-foreground text-xs">{formatPercent(p.shareBp / 10000, locale, 2)}</p>
                    <Money value={p.amount} tone="signed" className="mt-2 block text-xl font-semibold" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t("finances.closed.nothingShared")}</p>
            )}
          </Panel>
          <Panel title={t("finances.closed.entries")}>
            <EntryList entries={others} empty={t("finances.expenses.empty")} />
          </Panel>
        </div>

        <aside className="min-w-0 space-y-6">
          <Panel title={t("finances.settlement.title", { name: instructor })}>
            <div className="text-sm">
              <Row label={t("columns.instructorFees")} value={totals.instructorFee} />
              <Row label={t("finances.settlement.advanceUsed")} value={advanceUsed} tone="negative" />
              <Row label={t("finances.settlement.paid")} value={paid} tone="negative" />
              <Row label={t("finances.settlement.owed")} value={owed} strong />
            </div>
            <p className={cn("mt-3 text-sm", owed > 0 ? "text-warning" : "text-success")}>
              {owed > 0 ? t("finances.settlement.toPay") : t("finances.settlement.settled")}
            </p>
            {payments.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <EntryList entries={payments} empty="" />
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  )
}
