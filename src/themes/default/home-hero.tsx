import { ArrowRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import type { LogoData } from "@/lib/logo"
import { LogoPicture } from "../logo"

/**
 * The top of the home page: the brand (its logo when there is one), one sentence about the site (the SEO
 * description setting, else a default) and the way to the workshops (`cta`,
 * left out when there is none to show: the page below already says "coming
 * soon"). A theme can replace this section with its own (same props).
 */
export function HomeHero({ brand, logo, text, cta }: { brand: string; logo: LogoData | null; text: string; cta?: string }) {
  return (
    <section className="from-primary/8 border-b bg-linear-to-b to-transparent">
      <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 mx-auto w-full max-w-6xl px-4 py-14 motion-safe:duration-500 sm:py-20">
        {logo ? (
          <h1>
            <span className="sr-only">{brand}</span>
            <LogoPicture logo={logo} className="h-14 w-auto max-w-full sm:h-20" />
          </h1>
        ) : (
          <h1 className="font-serif text-4xl [font-weight:var(--site-font-heading-weight)] tracking-wide text-balance sm:text-6xl rtl:tracking-normal">
            {brand}
          </h1>
        )}
        <p className="text-muted-foreground mt-4 max-w-2xl text-lg text-pretty sm:text-xl">{text}</p>
        {cta && (
          <Button asChild className="mt-8 h-12 w-full rounded-xl px-6 text-base sm:w-auto">
            <Link href="/workshops">
              {cta}
              <ArrowRightIcon className="rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </section>
  )
}
