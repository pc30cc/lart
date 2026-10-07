"use client"

import { BanknoteIcon, CheckIcon, CopyIcon, CreditCardIcon, ExternalLinkIcon, LandmarkIcon, type LucideIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Fragment, useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { paymentWays } from "@/emails/payment"
import { isolate } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"
import { formatIban } from "../schema"

/** The payment ways that are on and usable: `paymentWays(setting, safePaymentUrl(course.paymentUrl), locale)`. */
export type PaymentWays = ReturnType<typeof paymentWays>

/**
 * How to pay a registration that is not paid yet: one card per way the super
 * admin switched on. Cash at the workshop; bank transfer (holder, bank, IBAN
 * in groups of four with a copy button, and "write the participant's name in
 * the description"); online: a big button to the workshop's payment link, in
 * a new tab. Used on the "you're registered" page and in My workshops.
 */
export function PaymentInstructions({
  ways,
  amount,
  participantName,
  className,
}: {
  ways: PaymentWays
  /** In kuruş. */
  amount: number
  participantName: string
  className?: string
}) {
  const t = useTranslations("registration.payment")
  const locale = useLocale()
  const price = isolate(formatLira(amount, locale))
  const count = [ways.cash, ways.transfer, ways.paymentUrl].filter(Boolean).length

  if (!count) {
    return <p className={cn("text-base leading-relaxed text-pretty", className)}>{t("none", { amount: price })}</p>
  }

  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-base leading-relaxed text-pretty">{t("intro", { count, amount: price })}</p>

      {ways.cash && (
        <Way icon={BanknoteIcon} title={t("cash.title")}>
          <p>{t("cash.text", { amount: price })}</p>
        </Way>
      )}

      {ways.transfer && (
        <Way icon={LandmarkIcon} title={t("transfer.title")}>
          <p>{t("transfer.text", { amount: price })}</p>
          {/* A container: two columns only when the card itself is wide (not in the narrow settings preview). */}
          <dl className="bg-muted/50 divide-border/70 @container divide-y rounded-xl text-sm">
            {ways.transfer.accountHolder && <Row label={t("transfer.holder")}>{ways.transfer.accountHolder}</Row>}
            {ways.transfer.bankName && <Row label={t("transfer.bank")}>{ways.transfer.bankName}</Row>}
            <Row label={t("transfer.iban")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* A line breaks only between groups of four, never inside one (read out or typed at the bank). */}
                <span dir="ltr" className="min-w-0 font-mono text-[0.95rem] tracking-wide select-all">
                  {formatIban(ways.transfer.iban)
                    .split(" ")
                    .map((group, i) => (
                      <Fragment key={i}>
                        {i > 0 && " "}
                        <span className="whitespace-nowrap">{group}</span>
                      </Fragment>
                    ))}
                </span>
                <CopyIban iban={ways.transfer.iban} />
              </div>
            </Row>
          </dl>
          <p className="font-medium">{t("transfer.reference", { name: participantName })}</p>
          {/* Admin-written, maybe in another language: its own direction, aligned with the card. */}
          {ways.transfer.note && (
            <p dir="auto" className="text-muted-foreground whitespace-pre-line rtl:text-right">
              {ways.transfer.note}
            </p>
          )}
        </Way>
      )}

      {ways.paymentUrl && (
        <Way icon={CreditCardIcon} title={t("online.title")}>
          <p>{t("online.text", { amount: price })}</p>
          <Button asChild className="h-12 w-full rounded-xl text-base">
            <a href={ways.paymentUrl} target="_blank" rel="noopener noreferrer">
              {t("online.button")}
              <ExternalLinkIcon className="size-4.5 rtl:-scale-x-100" aria-hidden />
              <span className="sr-only">({t("online.newTab")})</span>
            </a>
          </Button>
          <p className="text-muted-foreground">{t("online.after")}</p>
          {ways.onlineNote && (
            <p dir="auto" className="text-muted-foreground whitespace-pre-line rtl:text-right">
              {ways.onlineNote}
            </p>
          )}
        </Way>
      )}

      <p className="text-muted-foreground text-sm text-pretty">{t("confirmNote")}</p>
    </div>
  )
}

function Way({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card ring-foreground/8 rounded-2xl p-4 shadow-xs ring-1 sm:p-5">
      <h3 className="mb-3 flex items-center gap-2.5 text-base font-semibold">
        <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-4.5" aria-hidden />
        </span>
        {title}
      </h3>
      <div className="space-y-3 text-[0.95rem] leading-relaxed text-pretty">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 px-3.5 py-2.5 @sm:grid-cols-[8rem_minmax(0,1fr)] @sm:items-center @sm:gap-3">
      <dt className="text-muted-foreground text-xs @sm:text-sm">{label}</dt>
      <dd className="min-w-0 font-medium">{children}</dd>
    </div>
  )
}

function CopyIban({ iban }: { iban: string }) {
  const t = useTranslations("registration.payment.transfer")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(iban.replace(/\s+/g, ""))
      setCopied(true)
      toast.success(t("copied"))
    } catch {
      toast.error(t("copyFailed"))
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copy}
      className="h-10 shrink-0 rounded-lg px-3"
      aria-label={t("copyLabel")}
    >
      {copied ? <CheckIcon className="text-success" aria-hidden /> : <CopyIcon aria-hidden />}
      <span aria-hidden>{t("copy")}</span>
    </Button>
  )
}
