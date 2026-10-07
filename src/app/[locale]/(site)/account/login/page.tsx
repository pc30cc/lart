import { LogInIcon } from "lucide-react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { LoginForm } from "@/components/site/auth/login-form"
import { Link } from "@/i18n/navigation"
import { getMember } from "@/lib/auth/member"
import { safeNext } from "@/lib/auth/safe-next"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.login")
  return { title: t("metaTitle"), robots: { index: false, follow: false } }
}

/** Member log in. Comes back to `next` (any page of the site), else the workshops. */
export default async function MemberLoginPage({ params, searchParams }: PageProps<"/[locale]/account/login">) {
  const { locale } = await params
  const query = await searchParams
  const next = safeNext(query.next, "member", "")
  if (await getMember()) redirect(next || `/${locale}/workshops`)
  const t = await getTranslations("account.login")
  const signup = next ? `/account/signup?next=${encodeURIComponent(next)}` : "/account/signup"

  return (
    <AuthCard
      icon={<LogInIcon className="rtl:-scale-x-100" />}
      title={t("title")}
      subtitle={t("subtitle")}
      footer={
        <>
          {t("noAccount")}{" "}
          <Link href={signup} className="text-primary font-medium underline-offset-4 hover:underline">
            {t("signUp")}
          </Link>
        </>
      }
    >
      <LoginForm kind="member" next={next || undefined} />
    </AuthCard>
  )
}
