import { PaletteIcon } from "lucide-react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { InstructorSignupForm } from "@/components/site/auth/instructor-signup-form"
import { localeHref } from "@/i18n/links"
import { Link } from "@/i18n/navigation"
import { getInstructor } from "@/lib/auth/instructor"
import { ACCOUNT_PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas"
import { getBrand } from "@/lib/settings"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.instructor.signup")
  return { title: t("metaTitle") }
}

/**
 * An instructor's own sign-up. Not linked from the site (the team shares the
 * address); like every instructor page, never indexed. Wider than the other
 * sign-in pages: the profile has several fields in three languages.
 */
export default async function InstructorSignupPage({ params }: PageProps<"/[locale]/instructor/signup">) {
  const { locale } = await params
  if (await getInstructor()) redirect(await localeHref(locale, "/instructor"))
  const [t, brand] = await Promise.all([getTranslations("auth.instructor.signup"), getBrand(locale)])

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 mx-auto w-full max-w-2xl px-4 py-10 duration-500 sm:py-14">
      <div className="mb-7 flex flex-col items-center gap-3 text-center">
        <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl [&_svg]:size-6">
          <PaletteIcon />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{t("title", { brand })}</h1>
        <p className="text-muted-foreground max-w-lg text-base text-pretty">{t("subtitle", { brand })}</p>
      </div>
      <div className="bg-card ring-foreground/8 rounded-2xl p-5 shadow-sm ring-1 sm:p-8">
        <InstructorSignupForm minLength={ACCOUNT_PASSWORD_MIN_LENGTH} />
      </div>
      <p className="text-muted-foreground mt-6 text-center text-base">
        {t("hasAccount")}{" "}
        <Link href="/instructor/login" className="text-primary font-medium underline-offset-4 hover:underline">
          {t("logIn")}
        </Link>
      </p>
    </div>
  )
}
