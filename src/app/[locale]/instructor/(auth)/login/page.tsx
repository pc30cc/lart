import { LogInIcon } from "lucide-react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { LoginForm } from "@/components/site/auth/login-form"
import { localeHref, mainLocale } from "@/i18n/links"
import { Link } from "@/i18n/navigation"
import { getInstructor } from "@/lib/auth/instructor"
import { safeNext } from "@/lib/auth/safe-next"
import { getBrand } from "@/lib/settings"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.instructor.login")
  return { title: t("metaTitle") }
}

/** Instructor sign in: into the panel, or back to `next` inside it. Deactivated instructors cannot. */
export default async function InstructorLoginPage({ params, searchParams }: PageProps<"/[locale]/instructor/login">) {
  const { locale } = await params
  const query = await searchParams
  const next = safeNext(query.next, "instructor", "", await mainLocale())
  if (await getInstructor()) redirect(next || (await localeHref(locale, "/instructor")))
  const [t, brand] = await Promise.all([getTranslations("auth.instructor.login"), getBrand(locale)])

  return (
    <AuthCard
      icon={<LogInIcon className="rtl:-scale-x-100" />}
      title={t("title")}
      subtitle={t("subtitle", { brand })}
      footer={
        <>
          {t("noAccount")}{" "}
          <Link href="/instructor/signup" className="text-primary font-medium underline-offset-4 hover:underline">
            {t("signUp")}
          </Link>
        </>
      }
    >
      <LoginForm
        kind="instructor"
        next={next || undefined}
        notice={query.notice === "signedOut" ? t("signedOut") : undefined}
      />
    </AuthCard>
  )
}
