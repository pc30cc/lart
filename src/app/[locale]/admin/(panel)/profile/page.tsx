import { HandshakeIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { FormSection } from "@/components/admin/form/form"
import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import { getMyAbout, getMyProfile } from "@/features/partners/queries"
import { Link } from "@/i18n/navigation"
import { formatPercent } from "@/lib/format"
import { AboutForm } from "./_components/about-form"
import { PasswordButton } from "./_components/password-button"
import { ProfileForm } from "./_components/profile-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partners.profile")
  return { title: t("title") }
}

/**
 * My profile (from the user menu): each partner edits their own photo, name
 * and email, their entry on the public About page, sees their profit share
 * (changed together under Money → Partners) and can change their password.
 */
export default async function ProfilePage() {
  const [t, locale, profile, about] = await Promise.all([
    getTranslations("partners.profile"),
    getLocale(),
    getMyProfile(),
    getMyAbout(),
  ])

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ProfileForm profile={profile} />

      <div className="mt-10">
        <AboutForm about={about} />
      </div>

      <div className="mt-10 space-y-8">
        <FormSection title={t("share.title")} description={t("share.description")}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-3xl font-semibold tracking-tight tabular-nums">
                {formatPercent(profile.shareBp / 10000, locale, 2)}
              </div>
              <div className="text-muted-foreground text-sm">{t("share.label")}</div>
            </div>
            <Button asChild variant="outline" size="lg" className="px-4">
              <Link href="/admin/money/partners">
                <HandshakeIcon />
                {t("share.manage")}
              </Link>
            </Button>
          </div>
        </FormSection>

        <FormSection title={t("password.title")} description={t("password.description")}>
          <div>
            <PasswordButton email={profile.email} />
          </div>
        </FormSection>
      </div>
    </>
  )
}
