import "server-only"
import { getTranslations } from "next-intl/server"

import { conceal } from "@/lib/conceal"
import type { LogoData } from "@/lib/logo"
import { getSetting } from "@/lib/settings"
import type { FooterContent, NavItem } from "@/themes/types"

type Localized = { fa?: string; tr?: string; en?: string }

/** The legal pages in the footer: what payment providers look for on every page. */
const legalLinks = [
  ["/privacy", "privacy"],
  ["/distance-sales", "distanceSales"],
  ["/cancellation", "cancellation"],
] as const

/**
 * The site's menu and footer content in `locale` (Settings → Home page, else
 * the bundled texts; the email and phone concealed) and its logo (Settings →
 * Appearance), or null.
 */
export async function getSiteFrame(
  locale: string,
): Promise<{ nav: NavItem[]; footer: FooterContent; logo: LogoData | null }> {
  const [th, t, tl, home, logo] = await Promise.all([
    getTranslations({ locale, namespace: "site.header" }),
    getTranslations({ locale, namespace: "home.footer" }),
    getTranslations({ locale, namespace: "legal.links" }),
    getSetting("home"),
    getSetting("logo"),
  ])
  const about = (home.footer.about as Localized)[locale as keyof Localized]?.trim() || t("about")
  return {
    // The header: workshops and the partners' story (About stays in the footer).
    nav: [
      { href: "/workshops", label: th("workshops") },
      { href: "/story", label: th("story") },
    ],
    footer: {
      links: [
        { href: "/workshops", label: th("workshops") },
        { href: "/about", label: th("about") },
        { href: "/story", label: th("story") },
        { href: "/contact", label: tl("contact") },
      ],
      legal: legalLinks.map(([href, key]) => ({ href, label: tl(key) })),
      about,
      instagram: home.footer.instagram,
      // Never as text in the page: spam harvesters read it (themes/types `FooterContent`).
      emailCode: home.footer.email ? conceal(home.footer.email) : "",
      phoneCode: home.footer.phone ? conceal(home.footer.phone) : "",
    },
    logo,
  }
}
