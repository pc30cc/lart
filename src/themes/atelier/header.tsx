"use client"

import { LogOutIcon, MenuIcon, XIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Dialog } from "radix-ui"
import { Suspense, useEffect, useState, useTransition } from "react"

import { AccountMenu, useLoginHref } from "@/components/site/account-menu"
import { LocaleMenu } from "@/components/site/locale-menu"
import { useSwitchLocale } from "@/components/site/use-switch-locale"
import { Spinner } from "@/components/ui/spinner"
import { memberLogoutAction } from "@/features/accounts/actions"
import { Link, usePathname } from "@/i18n/navigation"
import { locales } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import type { HeaderMember, NavItem } from "../types"

/** How far the visitor scrolls down the home page before the header turns solid (px). */
const SOLID_AFTER = 200

/**
 * Atelier's sticky header: the brand as a wordmark on the start side; the
 * menu, the language and the account as pills on the end side (on a phone
 * one menu button opening a full-screen sheet). Over the home page's hero it
 * is see-through with cream text, and turns solid (cream, dark text, a
 * hairline) once the visitor scrolls; on every other page it is solid.
 * `overHero` is false while the "confirm your email" banner sits under it
 * (the hero then starts below the banner).
 */
export function Header({
  brand,
  member,
  top,
  nav,
  overHero,
}: {
  brand: string
  member: HeaderMember | null
  top: React.ReactNode
  nav: NavItem[]
  overHero: boolean
}) {
  const t = useTranslations("site.header")
  const pathname = usePathname()
  const onHero = overHero && pathname === "/"
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    if (!onHero) return
    const update = () => setScrolled(window.scrollY > SOLID_AFTER)
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [onHero])

  const clear = onHero && !scrolled

  return (
    <header
      data-clear={clear || undefined}
      className={cn(
        "sticky top-0 z-40 border-b transition-[background-color,color,border-color,box-shadow] duration-500 ease-out",
        clear
          ? "text-at-cream border-transparent bg-transparent"
          : "bg-background/96 supports-backdrop-filter:bg-background/88 text-foreground border-border/80 shadow-[0_10px_30px_-24px_rgb(91_49_30/0.45)] backdrop-blur-md",
      )}
    >
      {top}
      <div className="at-container flex h-16 items-center gap-4 md:h-20">
        <Link
          href="/"
          aria-label={t("home", { brand })}
          className="at-heading focus-visible:ring-ring/50 min-w-0 truncate rounded-md text-xl leading-none outline-none focus-visible:ring-3 sm:text-2xl ltr:tracking-[0.22em]! rtl:text-[26px]"
        >
          {brand}
        </Link>

        <nav aria-label={t("nav")} className="ms-auto hidden items-center gap-1 md:flex lg:gap-4">
          {nav.map((item) => {
            const current = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "at-caps focus-visible:ring-ring/50 relative rounded-md px-3 py-2.5 text-[13px] font-medium outline-none focus-visible:ring-3 rtl:text-[15px]",
                  "after:absolute after:inset-x-3 after:bottom-1 after:h-px after:origin-left after:scale-x-0 after:bg-current after:transition-transform after:duration-300 hover:after:scale-x-100 aria-[current=page]:after:scale-x-100 rtl:after:origin-right",
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="hidden shrink-0 items-center gap-2 md:flex lg:gap-3">
          {/* Both read the query string (to keep it when switching language / come back after logging in). */}
          <Suspense>
            <LocaleMenu
              signedIn={Boolean(member)}
              className={cn(
                "rounded-full border px-4",
                clear
                  ? "border-at-cream/45 text-at-cream hover:bg-at-cream/12 hover:text-at-cream"
                  : "border-foreground/20 hover:border-foreground/40",
              )}
            />
            <AccountMenu
              member={member}
              className={cn(
                "h-10 px-5 font-semibold",
                member ? "ps-1.5 pe-4" : "at-caps text-xs rtl:text-sm",
                clear
                  ? "bg-at-paper text-at-brown hover:bg-at-cream hover:text-at-brown dark:bg-at-paper dark:hover:bg-at-cream border-transparent"
                  : member
                    ? "border-foreground/20 bg-transparent hover:border-foreground/40"
                    : "bg-foreground text-background hover:bg-foreground/88",
              )}
            />
          </Suspense>
        </div>

        <Suspense>
          <MobileMenu brand={brand} member={member} nav={nav} clear={clear} />
        </Suspense>
      </div>
    </header>
  )
}

/**
 * The phone's menu: one round button opening a full-screen sheet in dark
 * brown with big links, the languages and the account. Every link closes it.
 */
function MobileMenu({ brand, member, nav, clear }: { brand: string; member: HeaderMember | null; nav: NavItem[]; clear: boolean }) {
  const t = useTranslations("site.header")
  const tm = useTranslations("home.atelier")
  const tc = useTranslations("common")
  const th = useTranslations("home.footer")
  const locale = useLocale()
  const pathname = usePathname()
  const loginHref = useLoginHref()
  const [open, setOpen] = useState(false)
  const { switchTo, pending: switching } = useSwitchLocale(Boolean(member))
  const [leaving, startLeaving] = useTransition()

  const links = [{ href: "/", label: th("home") }, ...nav]

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className={cn(
          "focus-visible:ring-ring/50 ms-auto flex size-11 shrink-0 items-center justify-center rounded-full border outline-none transition-colors focus-visible:ring-3 md:hidden",
          clear ? "border-at-cream/45 hover:bg-at-cream/12" : "border-foreground/20 hover:bg-muted",
        )}
        aria-label={tm("menu")}
      >
        <MenuIcon className="size-5" aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="bg-at-deep text-at-deep-foreground data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-2 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 z-50 flex flex-col overflow-y-auto duration-300"
        >
          <Dialog.Title className="sr-only">{tm("menu")}</Dialog.Title>
          <div className="at-container flex h-16 shrink-0 items-center gap-4">
            <span className="at-heading min-w-0 truncate text-xl leading-none ltr:tracking-[0.22em]! rtl:text-[26px]">{brand}</span>
            <Dialog.Close
              className="border-at-cream/35 hover:bg-at-cream/12 focus-visible:ring-at-cream/50 ms-auto flex size-11 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-3"
              aria-label={tm("closeMenu")}
            >
              <XIcon className="size-5" aria-hidden />
            </Dialog.Close>
          </div>

          <nav aria-label={t("nav")} className="at-container mt-6">
            <ul>
              {links.map((item) => {
                const current = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <li key={item.href} className="border-at-cream/15 border-b">
                    <Dialog.Close asChild>
                      <Link
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        className="at-heading focus-visible:ring-at-cream/50 flex items-center justify-between rounded-md py-4 text-[34px] leading-tight outline-none focus-visible:ring-3 aria-[current=page]:text-at-beige rtl:text-[30px]"
                      >
                        {item.label}
                      </Link>
                    </Dialog.Close>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className="at-container mt-auto space-y-8 pt-12 pb-10">
            <section aria-labelledby="at-menu-language">
              <h2 id="at-menu-language" className="at-caps text-at-cream/65 font-sans! text-xs! font-medium! rtl:text-sm!">
                {tc("language")}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {locales.map((l) => (
                  <button
                    key={l}
                    type="button"
                    lang={l}
                    disabled={switching}
                    aria-pressed={l === locale}
                    onClick={() => {
                      if (l !== locale) switchTo(l)
                      setOpen(false)
                    }}
                    className={cn(
                      "focus-visible:ring-at-cream/50 h-11 rounded-full border px-5 text-sm outline-none transition-colors focus-visible:ring-3 disabled:opacity-60",
                      l === "fa" && "font-(family-name:--font-iransans)",
                      l === locale ? "bg-at-cream text-at-brown border-transparent" : "border-at-cream/35 hover:bg-at-cream/12",
                    )}
                  >
                    {tc(`locales.${l}`)}
                  </button>
                ))}
              </div>
            </section>

            <section aria-labelledby="at-menu-account">
              <h2 id="at-menu-account" className="at-caps text-at-cream/65 font-sans! text-xs! font-medium! rtl:text-sm!">
                {t("account")}
              </h2>
              {member ? (
                <div className="mt-3 space-y-4">
                  <p className="min-w-0">
                    <span className="block truncate text-base font-medium">{member.name}</span>
                    <span className="text-at-cream/65 block truncate text-sm rtl:text-right" dir="ltr">
                      {member.email}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Dialog.Close asChild>
                      <Link
                        href="/account"
                        className="at-caps bg-at-cream text-at-brown focus-visible:ring-at-cream/50 inline-flex h-12 items-center rounded-full px-7 text-[13px] font-semibold outline-none focus-visible:ring-3 rtl:text-[15px]"
                      >
                        {t("myWorkshops")}
                      </Link>
                    </Dialog.Close>
                    <button
                      type="button"
                      disabled={leaving}
                      onClick={() => startLeaving(() => memberLogoutAction())}
                      className="at-caps border-at-cream/35 hover:bg-at-cream/12 focus-visible:ring-at-cream/50 inline-flex h-12 items-center gap-2 rounded-full border px-6 text-[13px] font-semibold outline-none focus-visible:ring-3 disabled:opacity-60 rtl:text-[15px]"
                    >
                      {leaving ? <Spinner aria-hidden /> : <LogOutIcon className="size-4 rtl:-scale-x-100" aria-hidden />}
                      {t("logOut")}
                    </button>
                  </div>
                </div>
              ) : (
                <Dialog.Close asChild>
                  <Link
                    href={loginHref}
                    className="at-caps bg-at-cream text-at-brown focus-visible:ring-at-cream/50 mt-3 flex h-13 w-full items-center justify-center rounded-full px-7 text-[13px] font-semibold outline-none focus-visible:ring-3 rtl:text-[15px]"
                  >
                    {t("logInOrSignUp")}
                  </Link>
                </Dialog.Close>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
