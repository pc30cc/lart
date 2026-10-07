"use client"

import {
  CalendarHeartIcon,
  FileSignatureIcon,
  HouseIcon,
  LanguagesIcon,
  LogOutIcon,
  UserRoundIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useTransition } from "react"

import { LocaleChoices } from "@/components/site/locale-menu"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { instructorLogoutAction } from "@/features/accounts/actions"
import { Link, usePathname } from "@/i18n/navigation"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import { usePanelLocale } from "./use-panel-locale"
import { ApprovalBanner, VerifyBanner } from "./verify-banner"

type NavItem = { href: string; key: "home" | "workshops" | "contracts" | "earnings" | "profile"; icon: LucideIcon }

const NAV: NavItem[] = [
  { href: "/instructor", key: "home", icon: HouseIcon },
  { href: "/instructor/workshops", key: "workshops", icon: CalendarHeartIcon },
  { href: "/instructor/contracts", key: "contracts", icon: FileSignatureIcon },
  { href: "/instructor/earnings", key: "earnings", icon: WalletIcon },
  { href: "/instructor/profile", key: "profile", icon: UserRoundIcon },
]

const isActive = (pathname: string, href: string) =>
  href === "/instructor" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

/**
 * The instructor panel's frame: the brand, the menu (in the header on larger
 * screens, a bar at the bottom on phones), language, theme and the account
 * menu, plus the "waiting for approval" and "Please confirm your email" banners. Nothing of it is printed.
 */
export function PanelShell({
  brand,
  name,
  email,
  emailVerified,
  approved,
  toSign,
  children,
}: {
  brand: string
  name: string
  email: string
  emailVerified: boolean
  /** False while the team has not approved a self-registered instructor: a banner says so. */
  approved: boolean
  /** Contracts waiting for a signature: a badge on "Contracts". */
  toSign: number
  children: React.ReactNode
}) {
  const t = useTranslations("instructorPanel")
  const pathname = usePathname()
  const badge = toSign > 0 ? t("nav.toSign", { count: toSign }) : null

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#content"
        className="bg-background focus:ring-ring sr-only z-50 rounded-md px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:ring-2"
      >
        {t("shell.skipToContent")}
      </a>
      <header className="bg-background/85 supports-backdrop-filter:bg-background/70 sticky top-0 z-40 border-b backdrop-blur-md print:hidden">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-2 px-4">
          <Link
            href="/instructor"
            aria-label={t("shell.home", { brand })}
            className="focus-visible:ring-ring/50 min-w-0 shrink truncate rounded-md font-serif text-xl font-medium tracking-wide outline-none focus-visible:ring-3 rtl:font-sans rtl:font-bold rtl:tracking-normal"
          >
            {brand}
          </Link>
          <nav aria-label={t("nav.label")} className="ms-4 hidden items-center gap-0.5 md:flex">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "focus-visible:ring-ring/50 relative inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3",
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {t(`nav.${item.key}`)}
                  {item.key === "contracts" && badge && <CountBadge count={toSign} label={badge} />}
                </Link>
              )
            })}
          </nav>
          <div className="ms-auto flex shrink-0 items-center gap-0.5">
            <LanguageMenu />
            <ThemeToggle />
            <AccountMenu name={name} email={email} />
          </div>
        </div>
      </header>

      {!approved && <ApprovalBanner />}
      {!emailVerified && <VerifyBanner email={email} />}

      <main
        id="content"
        key={pathname}
        className="animate-in fade-in-0 slide-in-from-bottom-1 mx-auto w-full max-w-4xl flex-1 px-4 pt-6 pb-28 duration-300 sm:pt-10 md:pb-16 print:max-w-none print:animate-none print:p-0"
      >
        {children}
      </main>

      <nav
        aria-label={t("nav.label")}
        className="bg-background/95 supports-backdrop-filter:bg-background/85 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden print:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href)
            const Icon = item.icon
            return (
              <li key={item.key} className="min-w-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "focus-visible:ring-ring/50 flex h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[0.7rem] font-medium outline-none focus-visible:ring-3 focus-visible:ring-inset",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "relative flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                      active && "bg-primary/12",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {item.key === "contracts" && badge && (
                      <CountBadge count={toSign} label={badge} className="absolute -top-1 end-1" />
                    )}
                  </span>
                  <span className="max-w-full truncate">{t(`nav.${item.key}`)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

/** A small number on the menu (e.g. contracts to sign), with its meaning for screen readers. */
function CountBadge({ count, label, className }: { count: number; label: string; className?: string }) {
  const locale = useLocale()
  return (
    <span
      className={cn(
        "bg-primary text-primary-foreground inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[0.65rem] leading-none font-semibold tabular-nums",
        className,
      )}
    >
      <span aria-hidden>{formatNumber(count, locale)}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** FA / TR / EN: also the language of the instructor's emails. */
function LanguageMenu() {
  const t = useTranslations("common")
  const locale = useLocale()
  const { switchTo, pending } = usePanelLocale()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn("h-10 gap-1.5 px-2.5 font-normal", pending && "opacity-60")}
          aria-label={t("language")}
        >
          <LanguagesIcon className="size-4.5" />
          <span className="text-xs font-medium tracking-wide uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        <DropdownMenuLabel className="text-muted-foreground text-xs">{t("language")}</DropdownMenuLabel>
        <LocaleChoices value={locale} onChange={switchTo} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The instructor's initial, with their name and email, "My profile" and "Log out". */
function AccountMenu({ name, email }: { name: string; email: string }) {
  const t = useTranslations("instructorPanel")
  const [leaving, startLeaving] = useTransition()
  const initial = name.trim().charAt(0).toUpperCase() || "?"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 rounded-full" aria-label={t("shell.account")}>
          <span className="bg-primary/12 text-primary flex size-8 items-center justify-center rounded-full text-sm font-semibold">
            {initial}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto max-w-72 min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2 font-normal">
          <span className="text-foreground truncate text-sm font-medium">{name}</span>
          <span className="text-muted-foreground truncate text-xs rtl:text-right" dir="ltr">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="py-2.5">
          <Link href="/instructor/profile">
            <UserRoundIcon />
            {t("shell.profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="py-2.5"
          disabled={leaving}
          onSelect={(event) => {
            event.preventDefault()
            startLeaving(() => instructorLogoutAction())
          }}
        >
          {leaving ? <Spinner aria-hidden /> : <LogOutIcon className="rtl:-scale-x-100" />}
          {t("shell.logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
