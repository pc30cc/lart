import { MailCheckIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { VerifyEmail } from "@/components/site/auth/verify-email"
import { getInstructor } from "@/lib/auth/instructor"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.verify")
  return { title: t("metaTitle") }
}

/**
 * The link from the instructor's verify email (sent after an admin changed
 * their address, from the panel's banner): confirms it, signed in or not.
 */
export default async function InstructorVerifyPage({ searchParams }: PageProps<"/[locale]/instructor/verify">) {
  const query = await searchParams
  const token = typeof query.token === "string" ? query.token : ""
  const [t, session] = await Promise.all([getTranslations("account.verify"), getInstructor()])

  return (
    <AuthCard icon={<MailCheckIcon />} title={t("title")}>
      <VerifyEmail
        kind="instructor"
        token={token}
        continueHref="/instructor"
        signedIn={Boolean(session && !session.instructor.emailVerified)}
      />
    </AuthCard>
  )
}
