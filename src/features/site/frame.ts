import "server-only"
import { getTranslations } from "next-intl/server"

import { getSetting } from "@/lib/settings"
import type { FooterContent, NavItem } from "@/themes/types"

type Localized = { fa?: string; tr?: string; en?: string }

/** The site's menu and footer content in `locale` (Settings → Home page, else the bundled texts). */
export async function getSiteFrame(locale: string): Promise<{ nav: NavItem[]; footer: FooterContent }> {
  const [th, t, home] = await Promise.all([
    getTranslations({ locale, namespace: "site.header" }),
    getTranslations({ locale, namespace: "home.footer" }),
    getSetting("home"),
  ])
  const about = (home.footer.about as Localized)[locale as keyof Localized]?.trim() || t("about")
  return {
    nav: [{ href: "/workshops", label: th("workshops") }],
    footer: { about, instagram: home.footer.instagram, email: home.footer.email, phone: home.footer.phone },
  }
}
