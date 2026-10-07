import { KeyRoundIcon, TicketIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { Button } from "@/components/ui/button"
import { ProfileForm } from "@/features/registrations/components/profile-form"
import { RegistrationCard } from "@/features/registrations/components/registration-card"
import { listMyRegistrations } from "@/features/registrations/member"
import { Link } from "@/i18n/navigation"
import { requireMember } from "@/lib/auth/member"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("registration.account")
  return { title: t("metaTitle"), robots: { index: false, follow: false } }
}

/**
 * "My workshops": the member's one simple page (students have no panel).
 * Upcoming registrations first, each with its payment status, how to pay and
 * cancel; then past and cancelled ones; then the member's details.
 */
export default async function MyWorkshopsPage({ params }: PageProps<"/[locale]/account">) {
  const { locale } = await params
  const { member, impersonatedBy } = await requireMember()
  const [t, registrations] = await Promise.all([getTranslations("registration.account"), listMyRegistrations(locale)])
  const now = new Date()
  const isUpcoming = (r: (typeof registrations)[number]) => r.status !== "cancelled" && r.course.endsAt > now
  // Soonest first for what's coming; latest first for the rest.
  const upcoming = registrations.filter(isUpcoming).reverse()
  const past = registrations.filter((r) => !isUpcoming(r))

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8 space-y-1.5">
        <h1 className="text-3xl font-semibold tracking-tight rtl:tracking-normal">{t("title")}</h1>
        <p className="text-muted-foreground text-base text-pretty">
          {t("hello", { name: member.name.split(/\s+/)[0] || member.name })} {t("subtitle")}
        </p>
      </header>

      {registrations.length === 0 ? (
        <EmptyState
          icon={TicketIcon}
          title={t("emptyTitle")}
          description={t("emptyText")}
          action={
            <Button asChild className="h-12 rounded-xl px-6 text-base">
              <Link href="/workshops">{t("browse")}</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-10">
          {upcoming.length > 0 && (
            <section className="space-y-4" aria-labelledby="upcoming">
              <h2 id="upcoming" className="text-xl font-semibold">
                {t("upcoming")}
              </h2>
              {upcoming.map((r) => (
                <RegistrationCard key={r.id} registration={r} now={now} />
              ))}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-4" aria-labelledby="past">
              <h2 id="past" className="text-muted-foreground text-xl font-semibold">
                {t("past")}
              </h2>
              {past.map((r) => (
                <RegistrationCard key={r.id} registration={r} now={now} />
              ))}
            </section>
          )}
          {upcoming.length === 0 && (
            <Button asChild variant="outline" className="h-12 w-full rounded-xl text-base">
              <Link href="/workshops">{t("browse")}</Link>
            </Button>
          )}
        </div>
      )}

      <section className="mt-14 space-y-4 border-t pt-10" aria-labelledby="details">
        <div className="space-y-1">
          <h2 id="details" className="text-xl font-semibold">
            {t("details")}
          </h2>
          <p className="text-muted-foreground text-sm">{t("detailsText")}</p>
        </div>
        <div className="bg-card ring-foreground/8 space-y-6 rounded-2xl p-5 shadow-xs ring-1 sm:p-6">
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">{t("email")}</p>
            {/* The block keeps the page direction (under its label); only the address is left to right. */}
            <p className="text-base font-medium break-all">
              <bdi dir="ltr">{member.email}</bdi>
            </p>
          </div>
          <ProfileForm name={member.name} phone={member.phone} locale={member.locale} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <div className="space-y-0.5">
              <p className="font-medium">{t("password")}</p>
              <p className="text-muted-foreground text-sm">
                {/* Only the member changes their own password, never a super admin viewing as them. */}
                {impersonatedBy ? t("passwordImpersonating") : t("passwordText")}
              </p>
            </div>
            {!impersonatedBy && (
              <Button asChild variant="outline" className="h-11 rounded-xl px-4">
                <Link href="/account/forgot">
                  <KeyRoundIcon aria-hidden />
                  {t("changePassword")}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
