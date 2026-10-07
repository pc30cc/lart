import { LogInIcon } from "lucide-react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { Button } from "@/components/ui/button"
import { partnerInviteDetails } from "@/features/partners/invites"
import { PARTNER_INVITE_TTL_MS } from "@/features/partners/schema"
import { localeHref } from "@/i18n/links"
import { Link } from "@/i18n/navigation"
import { getAdmin } from "@/lib/auth/admin"
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas"
import { getBrand } from "@/lib/settings"
import { AuthShell } from "../auth-shell"
import { AcceptForm } from "./accept-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partners.accept")
  return { title: t("metaTitle"), robots: { index: false, follow: false, nocache: true } }
}

/**
 * The link from a partner invitation: choose a password, then straight into
 * the panel as the new partner. The link is checked here and used by the
 * action (one time only). Open without a session; someone already signed in
 * (e.g. the inviter trying the link) is not sent away: accepting signs them out.
 * A link that no longer works takes someone signed in straight to the panel
 * (most likely the new partner opening the email's link again).
 */
export default async function AcceptPartnerInvitePage({ params, searchParams }: PageProps<"/[locale]/admin/invite">) {
  const { locale } = await params
  const query = await searchParams
  const token = typeof query.token === "string" ? query.token : ""
  const [t, brand, invite] = await Promise.all([
    getTranslations("partners.accept"),
    getBrand(locale),
    partnerInviteDetails(token),
  ])

  if (!invite) {
    if (await getAdmin()) redirect(await localeHref(locale, "/admin"))
    return (
      <AuthShell brand={brand} title={t("invalidTitle")} subtitle={t("invalid", { days: PARTNER_INVITE_TTL_MS / 86_400_000 })}>
        <Button asChild size="lg" className="h-10 w-full px-4">
          <Link href="/admin/login">
            <LogInIcon className="rtl:-scale-x-100" />
            {t("signIn")}
          </Link>
        </Button>
      </AuthShell>
    )
  }

  // U+2068 / U+2069 isolate the names, so a Latin name reads correctly inside Persian text (and vice versa).
  const isolate = (text: string) => `\u2068${text}\u2069`
  return (
    <AuthShell
      brand={brand}
      title={t("title", { name: isolate(invite.name) })}
      subtitle={t("subtitle", { inviter: isolate(invite.inviterName), brand })}
    >
      <AcceptForm token={token} email={invite.email} minLength={PASSWORD_MIN_LENGTH} />
    </AuthShell>
  )
}
