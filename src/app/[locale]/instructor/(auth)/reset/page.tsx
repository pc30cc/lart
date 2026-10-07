import { KeyRoundIcon, RotateCcwIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { NewPasswordForm } from "@/components/site/auth/new-password-form"
import { Button } from "@/components/ui/button"
import { isResetLinkValid } from "@/features/accounts/accounts"
import { Link } from "@/i18n/navigation"
import { ACCOUNT_PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas"
import { TOKEN_TTL } from "@/lib/auth/tokens"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.instructor.reset")
  return { title: t("metaTitle") }
}

/** The link from the reset email: a new password, then into the panel. */
export default async function InstructorResetPage({ searchParams }: PageProps<"/[locale]/instructor/reset">) {
  const query = await searchParams
  const token = typeof query.token === "string" ? query.token : ""
  const [t, valid] = await Promise.all([getTranslations("auth.instructor.reset"), isResetLinkValid("instructor", token)])

  if (!valid) {
    return (
      <AuthCard
        icon={<RotateCcwIcon />}
        title={t("invalidTitle")}
        subtitle={t("invalid", { minutes: TOKEN_TTL.reset_password / 60_000 })}
      >
        <Button asChild size="lg" className="h-12 w-full rounded-xl text-base">
          <Link href="/instructor/forgot">{t("requestNew")}</Link>
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard icon={<KeyRoundIcon />} title={t("title")} subtitle={t("subtitle")}>
      <NewPasswordForm
        purpose="instructor-reset"
        token={token}
        minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
        label={t("password")}
        submitLabel={t("submit")}
      />
    </AuthCard>
  )
}
