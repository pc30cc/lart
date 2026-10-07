import { LogInIcon } from "lucide-react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { AuthCard } from "@/components/site/auth-card"
import { LoginForm } from "@/components/site/auth/login-form"
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
  const next = safeNext(query.next, "instructor", "")
  if (await getInstructor()) redirect(next || `/${locale}/instructor`)
  const [t, brand] = await Promise.all([getTranslations("auth.instructor.login"), getBrand(locale)])

  return (
    <AuthCard icon={<LogInIcon className="rtl:-scale-x-100" />} title={t("title")} subtitle={t("subtitle", { brand })}>
      <LoginForm
        kind="instructor"
        next={next || undefined}
        notice={query.notice === "signedOut" ? t("signedOut") : undefined}
      />
    </AuthCard>
  )
}
