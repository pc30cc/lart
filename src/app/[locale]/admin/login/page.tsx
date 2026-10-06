import { LockKeyholeIcon } from "lucide-react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { LocaleSwitcher } from "@/components/locale-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { getAdmin } from "@/lib/auth/admin"
import { getBrand } from "@/lib/settings"
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
    <main className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/* Soft clay glow behind the card. */}
      <div
        aria-hidden
        className="from-primary/15 via-chart-3/10 pointer-events-none absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-radial to-transparent blur-3xl"
      />
      <div className="absolute end-3 top-3 flex items-center gap-0.5">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <div className="animate-in fade-in-0 zoom-in-95 relative w-full max-w-sm duration-500">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="from-primary to-chart-5 text-primary-foreground flex size-12 items-center justify-center rounded-2xl bg-linear-to-br text-lg font-bold shadow-md">
            {brand.trim().charAt(0).toUpperCase()}
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground text-sm text-balance">{t("subtitle", { brand })}</p>
          </div>
        </div>

        <div className="bg-card ring-foreground/8 rounded-2xl p-6 shadow-lg ring-1 sm:p-7">
          <LoginForm next={next} />
        </div>

        <p className="text-muted-foreground mt-6 flex items-center justify-center gap-1.5 text-xs">
          <LockKeyholeIcon className="size-3.5" />
          {t("footer", { brand })}
        </p>
      </div>
    </main>
  )
}
