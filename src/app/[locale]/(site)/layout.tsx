import { Suspense } from "react"

import { NoticeToast } from "@/components/site/notice-toast"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteHeader } from "@/components/site/site-header"
import { VerifyBanner } from "@/components/site/verify-banner"
import { getMember } from "@/lib/auth/member"
import { getBrand } from "@/lib/settings"

/**
 * The public site's frame (workshops, the member's account pages, ...): header,
 * the "Please confirm your email" banner for a signed-in member whose email is
 * not confirmed yet, and footer. Minimal until phase 3 brings the theme system.
 * Layouts are not re-rendered on client navigation: pages must check the
 * member themselves (`requireMember()`), never rely on this layout.
 */
export default async function SiteLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params
  const [brand, session] = await Promise.all([getBrand(locale), getMember()])
  const member = session && { name: session.member.name, email: session.member.email }

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader brand={brand} member={member} />
      {session && !session.member.emailVerified && <VerifyBanner email={session.member.email} />}
      <main className="flex flex-1 flex-col">{children}</main>
      <SiteFooter brand={brand} locale={locale} />
      <Suspense>
        <NoticeToast />
      </Suspense>
    </div>
  )
}
