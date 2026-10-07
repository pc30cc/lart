import { CalendarDaysIcon, ChevronLeftIcon, ClockIcon, HourglassIcon, MailIcon, MapPinIcon, UserRoundPlusIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { Button } from "@/components/ui/button"
import { RegisterForm } from "@/features/registrations/components/register-form"
import { ResendVerify } from "@/features/registrations/components/resend-verify"
import { getPublicWorkshop, myActiveRegistrations, workshopTerms } from "@/features/registrations/public"
import { isolate, paymentWayNames, sameParticipant } from "@/features/registrations/schema"
import { Link } from "@/i18n/navigation"
import { getMember } from "@/lib/auth/member"
import { formatDate, formatTimeRange } from "@/lib/format"
import { getBrand, getSetting } from "@/lib/settings"
import { Price } from "../../_components/labels"

export async function generateMetadata({ params }: PageProps<"/[locale]/workshops/[slug]/register">): Promise<Metadata> {
  const { locale, slug } = await params
  const w = await getPublicWorkshop(slug, locale)
  if (!w) return {}
  const t = await getTranslations({ locale, namespace: "registration.register" })
  return { title: t("metaTitle", { title: w.title }), robots: { index: false, follow: false } }
}

/**
 * Register for a workshop. Signed out: log in or create an account (both
 * come back here). Email not confirmed yet: a friendly prompt with "send it
 * again". Not open any more: says so. Otherwise the form.
 */
export default async function RegisterPage({ params }: PageProps<"/[locale]/workshops/[slug]/register">) {
  const { locale, slug } = await params
  const w = await getPublicWorkshop(slug, locale)
  if (!w) notFound()
  const [t, session] = await Promise.all([getTranslations("registration.register"), getMember()])
  const here = `/${locale}/workshops/${w.slug}/register`

  if (!session) {
    const next = encodeURIComponent(here)
    return (
      <AuthCard
        icon={<UserRoundPlusIcon />}
        title={t("signIn.title")}
        subtitle={t("signIn.text")}
        footer={<BackToWorkshop slug={w.slug} title={w.title} />}
      >
        <div className="space-y-3">
          <Button asChild className="h-12 w-full rounded-xl text-base">
            <Link href={`/account/signup?next=${next}`}>{t("signIn.signUp")}</Link>
          </Button>
          <Button asChild variant="outline" className="h-12 w-full rounded-xl text-base">
            <Link href={`/account/login?next=${next}`}>{t("signIn.logIn")}</Link>
          </Button>
        </div>
      </AuthCard>
    )
  }

  if (!session.member.emailVerified) {
    return (
      <AuthCard
        icon={<MailIcon />}
        title={t("verify.title")}
        subtitle={t("verify.text", { email: isolate(session.member.email) })}
        footer={<BackToWorkshop slug={w.slug} title={w.title} />}
      >
        <ResendVerify />
      </AuthCard>
    )
  }

  const tw = await getTranslations("registration.workshop")
  const terms = w.window === "open" ? await workshopTerms(w.termsTemplateId, locale) : null
  if (w.window !== "open" || !terms) {
    const state = w.window === "open" ? "paused" : w.window
    return (
      <AuthCard
        icon={<HourglassIcon />}
        title={tw(`state.${state}Title`)}
        subtitle={tw(`state.${state}Text`, { date: formatDate(w.registrationDeadline, locale, "long") })}
        footer={<BackToWorkshop slug={w.slug} title={w.title} />}
      >
        <Button asChild className="h-12 w-full rounded-xl text-base">
          <Link href="/workshops">{tw("allWorkshops")}</Link>
        </Button>
      </AuthCard>
    )
  }

  const [brand, payment, mine] = await Promise.all([getBrand(locale), getSetting("payment"), myActiveRegistrations(w.id)])
  // "Register someone else": no need to start with the member's own name when they already have a place.
  const defaultName = mine.some((r) => sameParticipant(r.participantName, session.member.name)) ? "" : session.member.name

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-16 sm:pt-8">
      <Link
        href={`/workshops/${w.slug}`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mb-4 inline-flex h-10 items-center gap-1 rounded-md text-sm outline-none focus-visible:ring-3"
      >
        <ChevronLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {w.title}
      </Link>

      <header className="mb-6 space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight rtl:tracking-normal">{t("title")}</h1>
        <p className="text-muted-foreground text-base text-pretty">{t("for", { title: w.title })}</p>
      </header>

      <div className="bg-card ring-foreground/8 mb-8 space-y-2 rounded-2xl p-4 text-[0.95rem] shadow-xs ring-1 sm:p-5">
        <p className="flex items-start gap-2.5">
          <CalendarDaysIcon className="text-primary mt-0.5 size-4.5 shrink-0" aria-hidden />
          {formatDate(w.startsAt, locale, "full")}
        </p>
        <p className="flex items-start gap-2.5">
          <ClockIcon className="text-primary mt-0.5 size-4.5 shrink-0" aria-hidden />
          <bdi>{formatTimeRange(w.startsAt, w.endsAt, locale)}</bdi>
        </p>
        <p className="flex items-start gap-2.5">
          <MapPinIcon className="text-primary mt-0.5 size-4.5 shrink-0" aria-hidden />
          {w.venue}
        </p>
        <p className="border-t pt-2">
          <Price value={w.price} className="text-lg" />
        </p>
      </div>

      <RegisterForm
        courseId={w.id}
        defaultName={defaultName}
        terms={{ text: terms.text, sha256: terms.sha256 }}
        brand={brand}
        ageRange={w.ageMin !== null && w.ageMax !== null ? { min: w.ageMin, max: w.ageMax } : null}
        price={w.price}
        ways={paymentWayNames(payment, w.paymentUrl)}
      />
    </div>
  )
}

function BackToWorkshop({ slug, title }: { slug: string; title: string }) {
  return (
    <Link
      href={`/workshops/${slug}`}
      className="hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3"
    >
      <ChevronLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
      {title}
    </Link>
  )
}
