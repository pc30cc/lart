import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { getAdmin } from "@/lib/auth/admin"
import { getBrand } from "@/lib/settings"
import { AuthShell } from "./auth-shell"
import { LoginForm } from "./login-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login")
  // The [locale] layout's title template adds the brand.
  return { title: t("metaTitle"), robots: { index: false, follow: false, nocache: true } }
}

export default async function AdminLoginPage({ params, searchParams }: PageProps<"/[locale]/admin/login">) {
  const { locale } = await params
  if (await getAdmin()) redirect(`/${locale}/admin`)
  const [t, brand, query] = await Promise.all([getTranslations("auth.login"), getBrand(locale), searchParams])
  const next = typeof query.next === "string" ? query.next : undefined

  return (
    <AuthShell brand={brand} title={t("title")} subtitle={t("subtitle", { brand })}>
      <LoginForm next={next} notice={query.reset === "done" ? t("resetDone") : undefined} />
    </AuthShell>
  )
}
