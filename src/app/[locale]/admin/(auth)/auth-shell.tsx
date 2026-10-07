import { LockKeyholeIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { LocaleSwitcher } from "@/components/locale-switcher"
import { ThemeToggle } from "@/components/theme-toggle"

/** The calm, centred card shared by the sign-in pages (sign in, forgot password, new password). */
export async function AuthShell({
  brand,
  title,
  subtitle,
  children,
}: {
  brand: string
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
}) {
  const t = await getTranslations("auth.login")

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
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-muted-foreground text-sm text-balance">{subtitle}</p>}
          </div>
        </div>

        <div className="bg-card ring-foreground/8 rounded-2xl p-6 shadow-lg ring-1 sm:p-7">{children}</div>

        <p className="text-muted-foreground mt-6 flex items-center justify-center gap-1.5 text-xs">
          <LockKeyholeIcon className="size-3.5" />
          {t("footer", { brand })}
        </p>
      </div>
    </main>
  )
}
