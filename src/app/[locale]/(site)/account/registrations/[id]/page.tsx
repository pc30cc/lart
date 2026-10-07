import {
  CalendarDaysIcon,
  CameraIcon,
  CameraOffIcon,
  ChevronLeftIcon,
  CircleCheckBigIcon,
  ClockIcon,
  FileCheckIcon,
  MapPinIcon,
  PartyPopperIcon,
  UserRoundIcon,
  VideoIcon,
  VideoOffIcon,
  type LucideIcon,
} from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { Money } from "@/components/admin/money"
import { Button } from "@/components/ui/button"
import { CancelRegistration } from "@/features/registrations/components/cancel-registration"
import { PaymentBadge } from "@/features/registrations/components/payment-badge"
import { PaymentInstructions } from "@/features/registrations/components/payment-instructions"
import { TermsText } from "@/features/registrations/components/terms-text"
import { getMyRegistration } from "@/features/registrations/member"
import { cancelPreview, canCancel, isolate, paymentState } from "@/features/registrations/schema"
import { Link } from "@/i18n/navigation"
import { formatDate, formatDateTime, formatTimeRange } from "@/lib/format"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("registration.detail")
  return { title: t("metaTitle"), robots: { index: false, follow: false } }
}

/**
 * One of the member's own registrations: after registering (`?welcome=1`) a
 * happy "you're registered" with how to pay; later its payment status, the
 * details, the photo / video choices and "Cancel my registration".
 * Someone else's registration is simply not found.
 */
export default async function MyRegistrationPage({ params, searchParams }: PageProps<"/[locale]/account/registrations/[id]">) {
  const { locale, id } = await params
  const welcome = (await searchParams).welcome === "1"
  const r = await getMyRegistration(id, locale)
  if (!r) notFound()
  const t = await getTranslations("registration")
  const now = new Date()
  const state = paymentState(r)
  const cancellable = canCancel(r, r.course, now)
  const unpaid = state === "unpaid" && cancellable

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pt-6 pb-16 sm:pt-8">
      <Link
        href="/account"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex h-10 items-center gap-1 rounded-md text-sm outline-none focus-visible:ring-3"
      >
        <ChevronLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("detail.back")}
      </Link>

      {welcome && state !== "cancelled" ? (
        <Banner icon={PartyPopperIcon} title={t("detail.welcomeTitle")}>
          {t("detail.welcomeText", { name: isolate(r.participantName) })}
          {state === "free" && ` ${t("detail.freeText")}`}
        </Banner>
      ) : state === "paid" ? (
        <Banner icon={CircleCheckBigIcon} title={t("detail.paidTitle")}>
          {t("detail.paidText")}
        </Banner>
      ) : state === "free" ? (
        <Banner icon={CircleCheckBigIcon} title={t("detail.freeTitle")}>
          {t("detail.freeText")}
        </Banner>
      ) : null}

      {unpaid && (
        <section className="space-y-3" aria-labelledby="how-to-pay">
          <h2 id="how-to-pay" className="text-xl font-semibold">
            {t("payment.title")}
          </h2>
          <PaymentInstructions ways={r.ways} amount={r.amount} participantName={r.participantName} />
        </section>
      )}

      <section className="bg-card ring-foreground/8 space-y-5 rounded-2xl p-5 shadow-xs ring-1 sm:p-6" aria-labelledby="registration">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 id="registration" className="text-muted-foreground text-sm font-medium">
              {t("detail.registration")}
            </h2>
            <p className="text-lg leading-snug font-semibold text-balance">
              {r.course.slug ? (
                <Link href={`/workshops/${r.course.slug}`} className="hover:text-primary focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-3">
                  {r.course.title}
                </Link>
              ) : (
                r.course.title
              )}
            </p>
          </div>
          <PaymentBadge registration={r} />
        </header>

        <dl className="space-y-3 text-[0.95rem]">
          <Fact icon={UserRoundIcon} label={t("item.participant")}>
            {r.participantName}
          </Fact>
          <Fact icon={CalendarDaysIcon} label={t("item.date")}>
            {formatDate(r.course.startsAt, locale, "full")}
          </Fact>
          <Fact icon={ClockIcon} label={t("item.time")}>
            <bdi>{formatTimeRange(r.course.startsAt, r.course.endsAt, locale)}</bdi>
          </Fact>
          <Fact icon={MapPinIcon} label={t("item.venue")}>
            {r.course.venue}
          </Fact>
          <div className="flex items-baseline justify-between gap-3 border-t pt-3">
            <dt className="text-muted-foreground">{t("item.amount")}</dt>
            <dd className="text-lg font-semibold">{r.amount > 0 ? <Money value={r.amount} /> : t("price.free")}</dd>
          </div>
        </dl>
        {state === "paid" && r.paymentMethod && (
          <p className="text-muted-foreground text-sm">
            {t(`detail.method.${r.paymentMethod as "cash" | "transfer" | "online"}`)}
            {r.paidAt && ` · ${formatDate(r.paidAt, locale, "long")}`}
          </p>
        )}
        {r.course.status === "cancelled" && r.status === "cancelled" && (
          <p className="text-muted-foreground text-sm">{t("status.workshopCancelled")}</p>
        )}

        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">{t("detail.consent")}</h3>
          <ul className="text-muted-foreground space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              {r.photoConsent ? <CameraIcon className="size-4" aria-hidden /> : <CameraOffIcon className="size-4" aria-hidden />}
              {r.photoConsent ? t("detail.photoYes") : t("detail.photoNo")}
            </li>
            <li className="flex items-center gap-2">
              {r.videoConsent ? <VideoIcon className="size-4" aria-hidden /> : <VideoOffIcon className="size-4" aria-hidden />}
              {r.videoConsent ? t("detail.videoYes") : t("detail.videoNo")}
            </li>
            <li className="flex items-center gap-2">
              <FileCheckIcon className="size-4" aria-hidden />
              {t("detail.termsAccepted", { date: formatDateTime(r.termsAcceptedAt, locale, "long") })}
            </li>
          </ul>
          {r.terms && (
            <details className="group text-sm">
              <summary className="text-primary focus-visible:ring-ring/50 inline-flex h-10 cursor-pointer items-center rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3">
                {t("register.terms")}
              </summary>
              <TermsText text={r.terms} className="bg-muted/40 mt-1 max-h-96 overflow-y-auto rounded-xl p-4 text-sm" />
            </details>
          )}
        </div>

        {cancellable && (
          <div className="flex justify-end border-t pt-4">
            <CancelRegistration
              id={r.id}
              participantName={r.participantName}
              preview={cancelPreview(r, r.course.startsAt, now)}
              free={r.amount === 0}
            />
          </div>
        )}
      </section>

      <Button asChild variant="outline" className="h-12 w-full rounded-xl text-base">
        <Link href="/account">{t("detail.back")}</Link>
      </Button>
    </div>
  )
}

/** Good news at the top of the page. */
function Banner({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="border-success/30 bg-success/8 animate-in fade-in-0 slide-in-from-bottom-2 flex items-start gap-3.5 rounded-2xl border p-5 duration-500"
    >
      <span className="bg-success/15 text-success flex size-11 shrink-0 items-center justify-center rounded-2xl">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-xl font-semibold">{title}</p>
        <p className="text-base leading-relaxed text-pretty">{children}</p>
      </div>
    </div>
  )
}

function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-muted-foreground mt-0.5 shrink-0">
        <Icon className="size-4.5" aria-hidden />
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
