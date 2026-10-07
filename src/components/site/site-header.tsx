import { getTranslations } from "next-intl/server"
import { Suspense } from "react"

import { Link } from "@/i18n/navigation"
import { AccountMenu } from "./account-menu"
import { LocaleMenu } from "./locale-menu"

export type HeaderMember = { name: string; email: string }

/**
 * The public site's header: the brand as a wordmark (to the home page), a
 * "Workshops" link, the language and the account button. Phase 3 replaces it
 * with the theme's own header (same data).
 */
export async function SiteHeader({ brand, member }: { brand: string; member: HeaderMember | null }) {
  const t = await getTranslations("site.header")
  const signedIn = Boolean(member)

  return (
    <header className="bg-background/85 supports-backdrop-filter:bg-background/70 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6">
        <Link
          href="/"
          className="focus-visible:ring-ring/50 min-w-0 shrink truncate rounded-md font-serif text-lg font-medium tracking-wide outline-none focus-visible:ring-3 sm:text-2xl rtl:font-sans rtl:font-bold rtl:tracking-normal"
          aria-label={t("home", { brand })}
        >
          {brand}
        </Link>
        <nav aria-label={t("nav")} className="shrink-0">
          <Link
            href="/workshops"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-md px-1 py-2 text-sm font-medium outline-none focus-visible:ring-3"
          >
            {t("workshops")}
          </Link>
        </nav>
        <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Both read the query string (to keep it when switching language / come back after logging in). */}
          <Suspense>
            <LocaleMenu signedIn={signedIn} />
            <AccountMenu member={member} />
          </Suspense>
        </div>
      </div>
    </header>
  )
}
