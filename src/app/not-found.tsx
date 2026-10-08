import { CompassIcon } from "lucide-react"
import type { Metadata } from "next"
import NextLink from "next/link"
import { getLocale, getTranslations } from "next-intl/server"

import { getBrand } from "@/lib/settings"

export async function generateMetadata(): Promise<Metadata> {
  const [t, brand] = await Promise.all([getTranslations("common.notFound"), getLocale().then(getBrand)])
  return { title: `${t("metaTitle")} · ${brand}`, robots: { index: false, follow: true } }
}

/**
 * The last not-found page: an address that is no language's (with a dot, the
 * proxy leaves it alone: /wp-login.php, /x.html), in the request's language.
 * Above the language layout, so server texts and a plain link only.
 */
export default async function RootNotFound() {
  const t = await getTranslations("common.notFound")
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl">
          <CompassIcon className="size-7" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{t("title")}</h1>
        <p className="text-muted-foreground text-pretty">{t("description")}</p>
        {/* Above the language layout: no localized Link (the proxy gives "/" the main language). */}
        <NextLink
          href="/"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 mt-2 inline-flex h-10 items-center rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-3"
        >
          {t("home")}
        </NextLink>
      </div>
    </main>
  )
}
