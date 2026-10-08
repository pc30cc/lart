"use client"

import { ArrowRightIcon, CalendarDaysIcon, HouseIcon, TicketIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Link, usePathname } from "@/i18n/navigation"
import { formatNumber } from "@/lib/format"

/**
 * The public site's not-found page, inside the theme's frame: a large, quiet
 * 404 (Persian digits in Persian), what happened in a sentence (a workshop's
 * own words when the address was a workshop's), and the ways back: the
 * upcoming workshops, the home page, and a member's own workshops when the
 * address was in their account. Only the theme's tokens, so every theme dresses
 * it. A client component: its language is always the page's.
 */
export function NotFoundView() {
  const t = useTranslations("site.notFound")
  const th = useTranslations("site.header")
  const locale = useLocale()
  const path = usePathname()
  const workshop = path.startsWith("/workshops/")
  const account = path === "/account" || path.startsWith("/account/")

  return (
    <section className="relative isolate mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:py-24">
      {/* A soft clay glow behind the number. */}
      <div
        aria-hidden
        className="bg-primary/10 absolute top-1/2 left-1/2 -z-10 size-[min(28rem,80vw)] -translate-x-1/2 -translate-y-[60%] rounded-full blur-3xl"
      />
      <p
        aria-hidden
        className="from-primary to-primary/35 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 bg-linear-to-b bg-clip-text font-serif text-[6.5rem] leading-none [font-weight:var(--site-font-heading-weight)] tracking-tight text-transparent motion-safe:duration-700 sm:text-[9rem]"
      >
        {formatNumber(404, locale, { useGrouping: false })}
      </p>
      <p className="text-primary mt-6 text-sm font-medium tracking-wide">{t("eyebrow")}</p>
      <h1 className="mt-3 font-serif text-3xl [font-weight:var(--site-font-heading-weight)] tracking-wide text-balance sm:text-5xl rtl:tracking-normal">
        {t("title")}
      </h1>
      <p className="text-muted-foreground mt-5 max-w-xl text-base text-pretty sm:text-lg">
        {workshop ? t("workshopDescription") : t("description")}
      </p>
      <div className="mt-10 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
        <Button asChild className="h-12 rounded-xl px-6 text-base">
          <Link href="/workshops">
            <CalendarDaysIcon aria-hidden />
            {t("workshops")}
            <ArrowRightIcon className="rtl:rotate-180" aria-hidden />
          </Link>
        </Button>
        {account ? (
          <Button asChild variant="outline" className="h-12 rounded-xl px-6 text-base">
            <Link href="/account">
              <TicketIcon aria-hidden />
              {th("myWorkshops")}
            </Link>
          </Button>
        ) : (
          <Button asChild variant="outline" className="h-12 rounded-xl px-6 text-base">
            <Link href="/">
              <HouseIcon aria-hidden />
              {t("home")}
            </Link>
          </Button>
        )}
      </div>
    </section>
  )
}
