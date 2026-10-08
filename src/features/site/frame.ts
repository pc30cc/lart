import "server-only"
import { getTranslations } from "next-intl/server"

import { conceal } from "@/lib/conceal"
import type { LogoData } from "@/lib/logo"
import { getSetting } from "@/lib/settings"
import type { FooterContent, NavItem } from "@/themes/types"

type Localized = { fa?: string; tr?: string; en?: string }

/**
 * The site's menu and footer content in `locale` (Settings → Home page, else
 * the bundled texts; the email and phone concealed) and its logo (Settings →
 * Appearance), or null.
 */
export async function getSiteFrame(
  locale: string,
): Promise<{ nav: NavItem[]; footer: FooterContent; logo: LogoData | null }> {
  const [th, t, home, logo] = await Promise.all([
    getTranslations({ locale, namespace: "site.header" }),
    getTranslations({ locale, namespace: "home.footer" }),
    getSetting("home"),
    getSetting("logo"),
  ])
  const about = (home.footer.about as Localized)[locale as keyof Localized]?.trim() || t("about")
  return {
    nav: [
      { href: "/workshops", label: th("workshops") },
      { href: "/about", label: th("about") },
    ],
    footer: {
      links: [
        { href: "/workshops", label: th("workshops") },
        { href: "/about", label: th("about") },
        { href: "/story", label: th("story") },
      ],
      about,
      instagram: home.footer.instagram,
      // Never as text in the page: spam harvesters read it (themes/types `FooterContent`).
      emailCode: home.footer.email ? conceal(home.footer.email) : "",
      phoneCode: home.footer.phone ? conceal(home.footer.phone) : "",
    },
    logo,
  }
}
