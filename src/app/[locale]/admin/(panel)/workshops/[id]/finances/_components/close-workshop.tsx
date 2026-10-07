"use client"

import { CircleAlertIcon, CircleCheckIcon, LockIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Money } from "@/components/admin/money"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { closeWorkshop } from "@/features/money/actions"
import type { ClosingFigures, ClosingIssue } from "@/features/money/closing"
import { Link } from "@/i18n/navigation"
import { formatPercent } from "@/lib/format"
import { formatLira } from "@/lib/money"

/**
 * The "Close workshop" step: what still stands in the way, or a button that
 * shows the exact final figures before they are locked.
 */
export function CloseWorkshop({
  courseId,
  title,
  figures,
  issues,
  unpaid,
  feeText,
}: {
  courseId: string
  title: string
  figures: ClosingFigures
  issues: ClosingIssue[]
  /** Registrations still to pay, for the "unpaidRegistrations" issue. */
  unpaid: number
  /** How the fee is made up, e.g. "8 × ₺500". */
  feeText: string
}) {
  const t = useTranslations("money")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const ready = issues.length === 0

  function confirm() {
    startTransition(async () => {
      try {
        const result = await closeWorkshop({
          courseId,
          revenue: figures.revenue,
          instructorFee: figures.instructorFee,
          expenses: figures.expenses,
          owedToInstructor: figures.owedToInstructor,
          partners: figures.partners.map(({ adminId, shareBp, amount }) => ({ adminId, shareBp, amount })),
        })
        if (!result) return
        if (result.ok) {
          setOpen(false)
          toast.success(t("close.done"))
        } else {
          toast.error(result.error)
        }
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <div className="space-y-4">
      {ready ? (
        <p className="text-success flex items-start gap-2 text-sm font-medium">
          <CircleCheckIcon className="mt-0.5 size-4 shrink-0" />
          {t("close.ready")}
        </p>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li key={issue} className="text-warning flex items-start gap-2 text-sm">
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <span className="text-pretty">
                {t(`close.issues.${issue}`, { count: unpaid })}
                {issue === "sharesNot100" && (
                  <>
                    {" "}
                    <Link href="/admin/money/partners" className="font-medium underline underline-offset-3">
                      {t("close.fixShares")}
                    </Link>
                  </>
                )}
                {issue === "refundsOwed" && (
                  <>
                    {" "}
                    <Link href="/admin/money/refunds" className="font-medium underline underline-offset-3">
                      {t("close.openRefunds")}
                    </Link>
                  </>
                )}
                {issue === "unpaidRegistrations" && (
                  <>
                    {" "}
                    <Link href={`/admin/workshops/${courseId}/registrations`} className="font-medium underline underline-offset-3">
                      {t("close.openRegistrations")}
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogTrigger asChild>
          <Button size="lg" className="w-full px-4 sm:w-auto" disabled={!ready}>
            <LockIcon />
            {t("close.trigger")}
          </Button>
        </DialogTrigger>
        <DialogContent showCloseButton={false} className="gap-5 p-5 sm:max-w-lg">
          <DialogHeader className="text-start">
            <DialogTitle className="text-lg">{t("close.title", { title })}</DialogTitle>
            <DialogDescription className="text-pretty">{t("close.description")}</DialogDescription>
          </DialogHeader>

          <dl className="bg-muted/40 divide-y rounded-xl px-4 text-sm">
            <Line label={t("columns.revenue")} value={figures.revenue} />
            <Line label={t("columns.instructorFees")} hint={feeText} value={-figures.instructorFee} signed />
            <Line label={t("columns.courseExpenses")} value={-figures.expenses} signed />
            <div className="flex items-baseline justify-between gap-4 py-3 text-base font-semibold">
              <dt>{t("columns.net")}</dt>
              <dd>
                <Money value={figures.netProfit} tone="signed" />
              </dd>
            </div>
          </dl>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{figures.netProfit >= 0 ? t("close.profitTo") : t("close.lossTo")}</h3>
            <ul className="space-y-1.5 text-sm">
              {figures.partners.map((p) => (
                <li key={p.adminId} className="flex items-baseline justify-between gap-4">
                  <span>
                    {p.name} <span className="text-muted-foreground">· {formatPercent(p.shareBp / 10000, locale, 2)}</span>
                  </span>
                  <Money value={p.amount} tone="signed" className="font-medium" />
                </li>
              ))}
            </ul>
          </div>

          {figures.instructorFee > 0 && (
            <p className="text-muted-foreground text-sm text-pretty">
              {figures.advance > 0
                ? t("close.instructorWithAdvance", {
                    advance: formatLira(figures.advance, locale),
                    owed: formatLira(figures.owedToInstructor, locale),
                  })
                : t("close.instructorOwed", { owed: formatLira(figures.owedToInstructor, locale) })}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="ghost" size="lg" disabled={pending}>
                {tc("actions.cancel")}
              </Button>
            </DialogClose>
            <Button size="lg" className="px-4" onClick={confirm} disabled={pending}>
              {pending ? <Spinner aria-hidden /> : <LockIcon />}
              {t("close.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Line({ label, hint, value, signed }: { label: string; hint?: string; value: number; signed?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground min-w-0">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </dt>
      <dd className="font-medium">
        <Money value={value} tone={signed ? "signed" : "plain"} />
      </dd>
    </div>
  )
}
