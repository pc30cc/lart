import { SparklesIcon } from "lucide-react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { SignupForm } from "@/components/site/auth/signup-form"
import { Link } from "@/i18n/navigation"
import { getMember } from "@/lib/auth/member"
import { safeNext } from "@/lib/auth/safe-next"
import { ACCOUNT_PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.signup")
  return { title: t("metaTitle"), robots: { index: false, follow: false } }
}

/** Sign up, then straight back to `next` (or the workshops), signed in. */
export default async function SignupPage({ params, searchParams }: PageProps<"/[locale]/account/signup">) {
  const { locale } = await params
  const query = await searchParams
  const next = safeNext(query.next, "member", "")
  if (await getMember()) redirect(next || `/${locale}/workshops`)
  const t = await getTranslations("account.signup")
  const login = next ? `/account/login?next=${encodeURIComponent(next)}` : "/account/login"

  return (
    <AuthCard
      icon={<SparklesIcon />}
      title={t("title")}
      subtitle={t("subtitle")}
      footer={
        <>
          {t("hasAccount")}{" "}
          <Link href={login} className="text-primary font-medium underline-offset-4 hover:underline">
            {t("logIn")}
          </Link>
        </>
      }
    >
      <SignupForm next={next || undefined} minLength={ACCOUNT_PASSWORD_MIN_LENGTH} />
    </AuthCard>
  )
}
