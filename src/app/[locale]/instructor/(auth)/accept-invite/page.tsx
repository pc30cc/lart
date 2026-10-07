import { HeartHandshakeIcon, MailWarningIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { NewPasswordForm } from "@/components/site/auth/new-password-form"
import { Button } from "@/components/ui/button"
import { inviteDetails } from "@/features/accounts/accounts"
import { INVITE_TTL_MS } from "@/features/instructors/schema"
import { Link } from "@/i18n/navigation"
import { ACCOUNT_PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas"
import { getBrand } from "@/lib/settings"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.instructor.invite")
  return { title: t("metaTitle") }
}

/**
 * The link from the invitation email: choose a password, then straight into
 * the panel. The link is checked here and used by the action (one time only).
 */
export default async function AcceptInvitePage({ params, searchParams }: PageProps<"/[locale]/instructor/accept-invite">) {
  const { locale } = await params
  const query = await searchParams
  const token = typeof query.token === "string" ? query.token : ""
  const [t, brand, invite] = await Promise.all([
    getTranslations("auth.instructor.invite"),
    getBrand(locale),
    inviteDetails(token, locale),
  ])

  if (!invite) {
    return (
      <AuthCard
        icon={<MailWarningIcon />}
        title={t("invalidTitle")}
        subtitle={t("invalid", { days: INVITE_TTL_MS / 86_400_000, brand })}
        footer={t("haveAccount")}
      >
        <Button asChild size="lg" className="h-12 w-full rounded-xl text-base">
          <Link href="/instructor/login">{t("signIn")}</Link>
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      icon={<HeartHandshakeIcon />}
      title={t("title", { name: invite.name })}
      // U+2068 / U+2069 isolate the address, so it reads correctly inside Persian text.
      subtitle={t("subtitle", { email: `⁨${invite.email}⁩`, brand })}
    >
      <NewPasswordForm
        purpose="invite"
        token={token}
        minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
        label={t("password")}
        submitLabel={t("submit")}
        username={invite.email}
      />
    </AuthCard>
  )
}
