import type { Viewport } from "next"
import { Suspense } from "react"

import { ImpersonationBar } from "@/components/impersonation-bar"
import { NoticeToast } from "@/components/site/notice-toast"
import { VerifyBanner } from "@/components/site/verify-banner"
import { getSiteFrame } from "@/features/site/frame"
import { getMember } from "@/lib/auth/member"
import { getBrand } from "@/lib/settings"
import { getActiveTheme } from "@/themes/registry"
import { SiteRoot } from "@/themes/site-root"

/** The browser's theme colour follows the active theme. */
export async function generateViewport(): Promise<Viewport> {
  const { theme } = await getActiveTheme()
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: theme.themeColor.light },
      { media: "(prefers-color-scheme: dark)", color: theme.themeColor.dark },
    ],
  }
}

/**
 * The public site's frame (workshops, the member's account pages, ...): the
 * active theme's frame (src/themes; Settings → Appearance) with the chosen
 * fonts, around the page. While a super admin views as the member, the
 * "viewing as" bar tops the header on every page (only the admin's name
 * reaches the browser, never their id); a member whose email is not confirmed
 * sees the "Please confirm your email" banner.
 * Layouts are not re-rendered on client navigation: pages must check the
 * member themselves (`requireMember()`), never rely on this layout.
 */
export default async function SiteLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params
  const [brand, session, { theme, fonts }, frame] = await Promise.all([
    getBrand(locale),
    getMember(),
    getActiveTheme(),
    getSiteFrame(locale),
  ])
  const member = session && { name: session.member.name, email: session.member.email }

  return (
    <SiteRoot themeId={theme.id} fonts={fonts} locale={locale}>
      <theme.Frame
        locale={locale}
        brand={brand}
        member={member}
        top={
          session?.impersonatedBy ? (
            <ImpersonationBar
              kind="member"
              personId={session.member.id}
              personName={session.member.name}
              adminName={session.impersonatedBy.name}
              width="max-w-6xl"
            />
          ) : null
        }
        banner={session && !session.member.emailVerified ? <VerifyBanner email={session.member.email} /> : null}
        nav={frame.nav}
        footer={frame.footer}
      >
        {children}
      </theme.Frame>
      <Suspense>
        <NoticeToast />
      </Suspense>
    </SiteRoot>
  )
}
