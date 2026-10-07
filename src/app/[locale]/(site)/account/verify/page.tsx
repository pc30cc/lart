import { MailCheckIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { VerifyEmail } from "@/components/site/auth/verify-email"
import { getMember } from "@/lib/auth/member"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.verify")
  return { title: t("metaTitle"), robots: { index: false, follow: false } }
}

/** The link from the welcome email: confirms the member's email (signed in or not). */
export default async function VerifyEmailPage({ searchParams }: PageProps<"/[locale]/account/verify">) {
  const query = await searchParams
  const token = typeof query.token === "string" ? query.token : ""
  const [t, session] = await Promise.all([getTranslations("account.verify"), getMember()])

  return (
    <AuthCard icon={<MailCheckIcon />} title={t("title")}>
      <VerifyEmail
        kind="member"
        token={token}
        continueHref="/workshops"
        signedIn={Boolean(session && !session.member.emailVerified)}
      />
    </AuthCard>
  )
}
