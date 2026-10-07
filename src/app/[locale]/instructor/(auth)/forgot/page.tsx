import { KeyRoundIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { ForgotForm } from "@/components/site/auth/forgot-form"
import { TOKEN_TTL } from "@/lib/auth/tokens"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.instructor.forgot")
  return { title: t("metaTitle") }
}

/** "Forgot your password?" for instructors: the same answer for any address. */
export default async function InstructorForgotPage() {
  const t = await getTranslations("auth.instructor.forgot")
  return (
    <AuthCard icon={<KeyRoundIcon />} title={t("title")} subtitle={t("subtitle")}>
      <ForgotForm kind="instructor" minutes={TOKEN_TTL.reset_password / 60_000} />
    </AuthCard>
  )
}
