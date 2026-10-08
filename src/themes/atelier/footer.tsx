import { MailIcon, PhoneIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { ThemeToggle } from "@/components/theme-toggle"
import { Link } from "@/i18n/navigation"
import { formatYear } from "@/lib/format"
import { cn } from "@/lib/utils"
import { BrandLogo } from "../logo"
import type { FooterContent, HeaderMember, LogoSize, NavItem } from "../types"
import { Wordmark } from "./wordmark"

/**
 * Atelier's footer, in dark brown: link columns (Explore, My account,
 * Contact: only the ways in that are set), "About us", then the brand as a
 * giant wordmark (its logo when there is one) cut off by a light bar with the
 * copyright and the light / dark switch.
 */
export async function Footer({
  brand,
  logo,
  locale,
  member,
  nav,
  footer,
}: {
  brand: string
  logo: LogoSize | null
  locale: string
  member: HeaderMember | null
  nav: NavItem[]
  footer: FooterContent
}) {
  const [t, th, tf] = await Promise.all([
    getTranslations("home.footer"),
    getTranslations("site.header"),
    getTranslations("site.footer"),
  ])
  // This year in the language's calendar (۱۴۰۵ in Persian).
  const year = formatYear(new Date(), locale)

  const contacts = [
    footer.email && { href: `mailto:${footer.email}`, label: footer.email, icon: <MailIcon />, ltr: true, wrap: true },
    footer.phone && { href: `tel:${footer.phone.replace(/[^\d+]/g, "")}`, label: footer.phone, icon: <PhoneIcon />, ltr: true, wrap: false },
    // Only a web address (never a javascript: or other scheme typed into the setting).
    /^https:\/\/[^\s"]+$/i.test(footer.instagram) && { href: footer.instagram, label: t("instagram"), icon: <InstagramGlyph />, ltr: false, wrap: false },
  ].filter((c) => !!c)

  return (
    <footer className="bg-at-deep text-at-deep-foreground mt-auto">
      <div className="at-container pt-16 pb-14 sm:pt-20 lg:pt-24 lg:pb-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-12 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.7fr)] lg:gap-x-12">
          <Column title={t("explore")}>
            <FooterLink href="/">{t("home")}</FooterLink>
            {nav.map((item) => (
              <FooterLink key={item.href} href={item.href}>
                {item.label}
              </FooterLink>
            ))}
          </Column>
          <Column title={t("account")}>
            {member ? (
              <FooterLink href="/account">{th("myWorkshops")}</FooterLink>
            ) : (
              <FooterLink href="/account/login">{th("logInOrSignUp")}</FooterLink>
            )}
          </Column>
          {contacts.length > 0 && (
            // On a phone the whole row: an email address in half of it would break mid-domain.
            <Column title={t("contact")} className="col-span-2 md:col-span-1">
              {contacts.map((c) => (
                <li key={c.href}>
                  <a
                    href={c.href}
                    {...(c.ltr ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                    className={cn(
                      "hover:text-at-cream focus-visible:ring-at-cream/50 text-at-cream/80 inline-flex max-w-full items-center gap-2.5 rounded-sm outline-none focus-visible:ring-3 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-70",
                      c.wrap ? "[overflow-wrap:anywhere]" : "whitespace-nowrap",
                    )}
                  >
                    {c.icon}
                    <span dir={c.ltr ? "ltr" : undefined}>{c.label}</span>
                  </a>
                </li>
              ))}
            </Column>
          )}
          <div className="col-span-2 md:col-span-1 md:col-start-4">
            <ColumnTitle>{t("aboutTitle")}</ColumnTitle>
            <p className="text-at-cream/80 mt-5 max-w-md text-[15px] leading-relaxed whitespace-pre-line text-pretty">{footer.about}</p>
          </div>
        </div>
      </div>

      {logo ? <LogoWordmark logo={logo} /> : <Wordmark text={brand} />}

      <div className="bg-at-bar text-foreground relative">
        <div className="at-container flex min-h-16 items-center justify-between gap-4 py-3 text-sm">
          <p>{tf("rights", { brand, year })}</p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  )
}

/**
 * How much of the logo's height shows above the bar: its feet go behind it, as
 * the wordmark's capitals' do (less is cut than of capitals, so lowercase
 * letters keep their bowls and tails).
 */
const LOGO_SHOWN = 0.93
/** Room above the logo, as a share of its height. */
const LOGO_ABOVE = 0.04
/** The most the logo may take in height, as a share of the page's width (a squarer logo then keeps to the start side). */
const LOGO_MAX_HEIGHT = 0.36

/**
 * The logo as the footer's giant wordmark: as wide as the page and cut off by
 * the bar under it, like the brand's letters in `Wordmark`. Plain CSS: the
 * logo's own proportions give its size. Decorative (the brand is in the
 * header and in the bar).
 */
function LogoWordmark({ logo }: { logo: LogoSize }) {
  const shown = logo.height * (LOGO_ABOVE + LOGO_SHOWN)
  const width = Math.min(1, (logo.width * LOGO_MAX_HEIGHT) / shown)
  return (
    <div aria-hidden className="at-container select-none">
      <div
        className="relative overflow-hidden"
        style={{ width: `${(width * 100).toFixed(3)}%`, aspectRatio: `${logo.width} / ${shown}` }}
      >
        <div className="absolute inset-x-0" style={{ top: `${((LOGO_ABOVE / (LOGO_ABOVE + LOGO_SHOWN)) * 100).toFixed(3)}%` }}>
          <BrandLogo logo={logo} className="block h-auto w-full" />
        </div>
      </div>
    </div>
  )
}

function ColumnTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-at-cream text-[17px] leading-tight ltr:tracking-[0.14em]! rtl:text-lg">{children}</h2>
  )
}

function Column({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <ColumnTitle>{title}</ColumnTitle>
      <ul className="mt-5 space-y-3 text-[15px]">{children}</ul>
    </div>
  )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="text-at-cream/80 hover:text-at-cream focus-visible:ring-at-cream/50 rounded-sm underline-offset-[6px] outline-none hover:underline focus-visible:ring-3"
      >
        {children}
      </Link>
    </li>
  )
}

/** Instagram's camera outline (lucide has no brand icons). */
function InstagramGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}
