import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { RESET_TOKEN_MS } from "@/lib/auth/account"
import { getBrand } from "@/lib/settings"
import { AuthShell } from "../auth-shell"
import { ForgotForm } from "./forgot-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgot")
  return { title: t("metaTitle"), robots: { index: false, follow: false, nocache: true } }
}

/** "Forgot your password?": asks for the email and sends a reset link. Open to signed-out visitors. */
export default async function ForgotPasswordPage({ params }: PageProps<"/[locale]/admin/login/forgot">) {
  const { locale } = await params
  const [t, brand] = await Promise.all([getTranslations("auth.forgot"), getBrand(locale)])

  return (
    <AuthShell brand={brand} title={t("title")} subtitle={t("subtitle")}>
      <ForgotForm minutes={RESET_TOKEN_MS / 60_000} />
    </AuthShell>
  )
}
