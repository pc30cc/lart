import { RotateCcwIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { isAdminResetTokenValid, RESET_TOKEN_MS } from "@/lib/auth/account"
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas"
import { getBrand } from "@/lib/settings"
import { AuthShell } from "../auth-shell"
import { ResetForm } from "./reset-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.reset")
  return { title: t("metaTitle"), robots: { index: false, follow: false, nocache: true } }
}

/** The link from the reset email: choose a new password (the token is checked, not used, here). */
export default async function ResetPasswordPage({ params, searchParams }: PageProps<"/[locale]/admin/reset">) {
  const { locale } = await params
  const query = await searchParams
  const token = typeof query.token === "string" ? query.token : ""
  const [t, brand, valid] = await Promise.all([
    getTranslations("auth.reset"),
    getBrand(locale),
    isAdminResetTokenValid(token),
  ])

  if (!valid) {
    return (
      <AuthShell
        brand={brand}
        title={t("invalidTitle")}
        subtitle={t("invalid", { minutes: RESET_TOKEN_MS / 60_000 })}
      >
        <Button asChild size="lg" className="h-10 w-full px-4">
          <Link href="/admin/forgot">
            <RotateCcwIcon />
            {t("requestNew")}
          </Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell brand={brand} title={t("title")} subtitle={t("subtitle")}>
      <ResetForm token={token} minLength={PASSWORD_MIN_LENGTH} />
    </AuthShell>
  )
}
