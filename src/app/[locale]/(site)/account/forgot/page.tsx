import { KeyRoundIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { ForgotForm } from "@/components/site/auth/forgot-form"
import { TOKEN_TTL } from "@/lib/auth/tokens"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.forgot")
  return { title: t("metaTitle"), robots: { index: false, follow: false } }
}

/** "Forgot your password?": sends a reset link; the same answer for any address. */
export default async function ForgotPasswordPage() {
  const t = await getTranslations("account.forgot")
  return (
    <AuthCard icon={<KeyRoundIcon />} title={t("title")} subtitle={t("subtitle")}>
      <ForgotForm kind="member" minutes={TOKEN_TTL.reset_password / 60_000} />
    </AuthCard>
  )
}
