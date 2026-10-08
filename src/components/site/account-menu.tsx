"use client"

import { ChevronDownIcon, LanguagesIcon, LogOutIcon, TicketIcon, UserRoundIcon } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { memberLogoutAction } from "@/features/accounts/actions"
import { useMainLocale } from "@/i18n/main-locale-context"
import { Link, usePathname } from "@/i18n/navigation"
import { localePath } from "@/i18n/paths"
import { areaOf, isOpenPath } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { LocaleChoices } from "./locale-menu"
import { useSwitchLocale } from "./use-switch-locale"

/** Pages where "Log in" should not come back to: the member's sign-in pages (they would loop or make no sense). */
const isAuthPage = (pathname: string) => areaOf(pathname) === "account" && isOpenPath(pathname)

/** "Log in" for a visitor: the login page, which comes back to this page afterwards (not from the sign-in pages). */
export function useLoginHref(): string {
  const locale = useLocale()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const main = useMainLocale()
  const query = searchParams.toString()
  const here = localePath(locale, pathname + (query ? `?${query}` : ""), main)
  return isAuthPage(pathname) ? "/account/login" : `/account/login?next=${encodeURIComponent(here)}`
}

/**
 * The account button in the site header: "Log in / Sign up" (which comes back
 * to this page), or the member's first name with a small menu: My workshops,
 * language, log out. On a phone only the icon or the initial shows (the
 * brand needs the room); the text stays for screen readers. A theme may
 * restyle the button (`className`).
 */
export function AccountMenu({ member, className }: { member: { name: string; email: string } | null; className?: string }) {
  const t = useTranslations("site.header")
  const locale = useLocale()
  const loginHref = useLoginHref()
  const { switchTo, pending: switching } = useSwitchLocale(true)
  const [leaving, startLeaving] = useTransition()

  if (!member) {
    return (
      <Button asChild className={cn("h-10 rounded-full px-4 text-sm max-sm:w-10 max-sm:px-0", className)}>
        <Link href={loginHref}>
          <UserRoundIcon className="size-4.5" />
          <span className="sr-only sm:hidden">{t("logIn")}</span>
          <span className="hidden sm:inline">{t("logInOrSignUp")}</span>
        </Link>
      </Button>
    )
  }

  const firstName = member.name.trim().split(/\s+/)[0] || member.name

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-10 max-w-32 gap-1.5 rounded-full ps-2.5 pe-3 text-sm max-sm:w-10 max-sm:px-0 sm:max-w-44", className)}
          aria-label={t("account")}
        >
          <span className="bg-primary/12 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
            {firstName.charAt(0).toUpperCase()}
          </span>
          <span className="truncate max-sm:hidden">{firstName}</span>
          <ChevronDownIcon className="text-muted-foreground size-4 shrink-0 max-sm:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2 font-normal">
          <span className="text-foreground truncate text-sm font-medium">{member.name}</span>
          <span className="text-muted-foreground truncate text-xs rtl:text-right" dir="ltr">
            {member.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="py-2.5">
          <Link href="/account">
            <TicketIcon />
            {t("myWorkshops")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-2.5" disabled={switching}>
            <LanguagesIcon className="text-muted-foreground size-4" />
            {t("language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-40">
            <LocaleChoices value={locale} onChange={switchTo} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="py-2.5"
          disabled={leaving}
          onSelect={(event) => {
            event.preventDefault()
            startLeaving(() => memberLogoutAction())
          }}
        >
          {leaving ? <Spinner aria-hidden /> : <LogOutIcon className="rtl:-scale-x-100" />}
          {t("logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
