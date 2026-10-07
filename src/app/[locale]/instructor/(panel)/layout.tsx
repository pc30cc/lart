import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { listContractsToSign } from "@/features/instructor-panel/queries"
import { profileText } from "@/features/instructors/schema"
import { requireInstructor } from "@/lib/auth/instructor"
import { getBrand } from "@/lib/settings"
import { PanelShell } from "./_components/panel-shell"

export async function generateMetadata({ params }: LayoutProps<"/[locale]/instructor">): Promise<Metadata> {
  const { locale } = await params
  const [brand, t] = await Promise.all([getBrand(locale), getTranslations("instructorPanel.meta")])
  return {
    title: { default: t("title"), template: `%s · ${t("title")} · ${brand}` },
    // Private: never indexed (the proxy also sends X-Robots-Tag), never linked from the site.
    robots: { index: false, follow: false, nocache: true },
  }
}

/**
 * The signed-in instructor panel. This check is for the frame only: every
 * page, query and action checks `requireInstructor()` again (layouts are not
 * re-run on client navigation) and reads only the instructor's own data.
 */
export default async function InstructorPanelLayout({ children, params }: LayoutProps<"/[locale]/instructor">) {
  const { locale } = await params
  const [{ instructor }, brand, toSign] = await Promise.all([requireInstructor(), getBrand(locale), listContractsToSign()])

  return (
    <PanelShell
      brand={brand}
      name={profileText(instructor.displayName, locale)}
      email={instructor.email}
      emailVerified={instructor.emailVerified}
      approved={instructor.approved}
      toSign={toSign.length}
    >
      {children}
    </PanelShell>
  )
}
