import { CalendarDaysIcon, ChevronRightIcon, ClockIcon, MapPinIcon, UserRoundIcon, type LucideIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { Money } from "@/components/admin/money"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { formatDate, formatTimeRange } from "@/lib/format"
import type { MyRegistration } from "../member"
import { cancelPreview, canCancel, paymentState } from "../schema"
import { CancelRegistration } from "./cancel-registration"
import { HowToPay } from "./how-to-pay"
import { PaymentBadge } from "./payment-badge"

/**
 * One of the member's registrations in My workshops: the workshop, who
 * attends, when and where, the price and a clear payment status; "How to
 * pay" while not paid yet, and "Cancel my registration" while possible.
 * A server component (`now` comes from the page).
 */
export function RegistrationCard({ registration: r, now }: { registration: MyRegistration; now: Date }) {
  const t = useTranslations("registration")
  const locale = useLocale()
  const state = paymentState(r)
  const cancellable = canCancel(r, r.course, now)

  return (
    <article className="bg-card ring-foreground/8 space-y-4 rounded-2xl p-5 shadow-xs ring-1 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h3 className="text-lg leading-snug font-semibold text-balance">
            {r.course.slug ? (
              <Link
                href={`/workshops/${r.course.slug}`}
                className="hover:text-primary focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-3"
              >
                {r.course.title}
              </Link>
            ) : (
              r.course.title
            )}
          </h3>
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <UserRoundIcon className="size-4 shrink-0" aria-hidden />
            <span className="sr-only">{t("item.participant")}: </span>
            {r.participantName}
          </p>
        </div>
        <PaymentBadge registration={r} />
      </header>

      <dl className="grid gap-x-6 gap-y-2 text-[0.95rem] sm:grid-cols-2">
        <Fact icon={CalendarDaysIcon} label={t("item.date")}>
          {formatDate(r.course.startsAt, locale, "full")}
        </Fact>
        <Fact icon={ClockIcon} label={t("item.time")}>
          <bdi>{formatTimeRange(r.course.startsAt, r.course.endsAt, locale)}</bdi>
        </Fact>
        <Fact icon={MapPinIcon} label={t("item.venue")}>
          {r.course.venue}
        </Fact>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground text-sm">{t("item.amount")}:</dt>
          <dd className="font-medium">
            <Money value={r.amount} />
          </dd>
        </div>
      </dl>

      {r.course.status === "cancelled" && r.status === "cancelled" && (
        <p className="text-muted-foreground text-sm">{t("status.workshopCancelled")}</p>
      )}

      {state === "unpaid" && cancellable && (
        <HowToPay ways={r.ways} amount={r.amount} participantName={r.participantName} />
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button asChild variant="outline" className="h-11 rounded-xl px-4 text-sm">
          <Link href={`/account/registrations/${r.id}`}>
            {t("item.details")}
            <ChevronRightIcon className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        </Button>
        {cancellable && (
          <span className="ms-auto">
            <CancelRegistration
              id={r.id}
              participantName={r.participantName}
              preview={cancelPreview(r, r.course.startsAt, now)}
            />
          </span>
        )}
      </footer>
    </article>
  )
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <dt className="text-muted-foreground mt-0.5 shrink-0">
        <Icon className="size-4.5" aria-hidden />
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
