import { LockKeyholeIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { LocaleSwitcher } from "@/components/locale-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { getBrand, getSetting } from "@/lib/settings"
import { LogoPicture } from "@/themes/logo"

/** Private pages: never indexed (the proxy also sends X-Robots-Tag), never linked from the site. */
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } }

/**
 * The instructor's sign-in pages (log in, invitation, forgot / new password,
 * confirm email): a calm full page with the brand, the language and the
 * theme, apart from the public site. The panel itself is `../(panel)`.
 */
export default async function InstructorAuthLayout({ children, params }: LayoutProps<"/[locale]/instructor">) {
  const { locale } = await params
  const [t, brand, logo] = await Promise.all([getTranslations("auth.instructor"), getBrand(locale), getSetting("logo")])

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden">
      {/* Soft clay glow behind the card. */}
      <div
        aria-hidden
        className="from-primary/15 via-chart-3/10 pointer-events-none absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-radial to-transparent blur-3xl"
      />
      <header className="relative flex items-center justify-between gap-2 px-4 py-3">
        {logo ? (
          <span>
            <span className="sr-only">{brand}</span>
            <LogoPicture logo={logo} className="h-8 w-auto" />
          </span>
        ) : (
          <span className="font-serif text-xl font-medium tracking-wide rtl:font-sans rtl:font-bold rtl:tracking-normal">
            {brand}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="relative flex flex-1 flex-col justify-center">{children}</main>
      <p className="text-muted-foreground relative flex items-center justify-center gap-1.5 px-4 pb-6 text-center text-xs">
        <LockKeyholeIcon className="size-3.5 shrink-0" />
        {t("footer", { brand })}
      </p>
    </div>
  )
}
