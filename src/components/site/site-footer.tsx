import { MailIcon, PhoneIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { ThemeToggle } from "@/components/theme-toggle"
import { Link } from "@/i18n/navigation"
import { formatYear } from "@/lib/format"
import type { FooterContent, NavItem } from "@/themes/types"
import { InstagramGlyph } from "./instagram-glyph"
import { LanguageLinks } from "./language-links"
import { ProtectedContact } from "./protected-contact"

/**
 * The classic theme's quiet footer: the menu's links (a phone's header has
 * room for the first only) and the ways in touch (the email and phone kept
 * from spam harvesters), the brand and the year, the page in the other
 * languages, and the light / dark switch.
 */
export async function SiteFooter({
  brand,
  locale,
  signedIn,
  nav,
  footer,
}: {
  brand: string
  locale: string
  signedIn: boolean
  nav: NavItem[]
  footer: FooterContent
}) {
  const [t, th, tf] = await Promise.all([getTranslations("site.footer"), getTranslations("site.header"), getTranslations("home.footer")])
  // Only a web address (never a javascript: or other scheme typed into the setting).
  const instagram = /^https:\/\/[^\s"]+$/i.test(footer.instagram) ? footer.instagram : ""
  const contact = "hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-2 rounded-sm outline-none focus-visible:ring-3 [&_svg]:size-4 [&_svg]:shrink-0"
  // This year in the language's calendar (۱۴۰۵ in Persian).
  const year = formatYear(new Date(), locale)

  return (
    <footer className="mt-auto border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-x-8 gap-y-4 px-4 pt-6 text-sm">
        <nav aria-label={th("nav")} className="flex flex-wrap gap-x-6 gap-y-2 font-medium">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-3">
              {item.label}
            </Link>
          ))}
        </nav>
        {(footer.emailCode || footer.phoneCode || instagram) && (
          <ul aria-label={tf("contact")} className="flex flex-wrap gap-x-6 gap-y-2">
            {footer.emailCode && (
              <li>
                <ProtectedContact kind="email" code={footer.emailCode} label={tf("showEmail")} icon={<MailIcon aria-hidden />} className={contact} />
              </li>
            )}
            {footer.phoneCode && (
              <li>
                <ProtectedContact kind="phone" code={footer.phoneCode} label={tf("showPhone")} icon={<PhoneIcon aria-hidden />} className={contact} />
              </li>
            )}
            {instagram && (
              <li>
                <a href={instagram} target="_blank" rel="noopener noreferrer" className={contact}>
                  <InstagramGlyph />
                  {tf("instagram")}
                </a>
              </li>
            )}
          </ul>
        )}
      </div>
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm">
        <p>{t("rights", { brand, year })}</p>
        <div className="flex items-center gap-4">
          <LanguageLinks signedIn={signedIn} linkClassName="hover:text-foreground" />
          <ThemeToggle />
        </div>
      </div>
    </footer>
  )
}
