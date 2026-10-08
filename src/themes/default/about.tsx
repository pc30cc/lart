import { ArrowRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import type { AboutData, AboutPartner } from "../types"

/**
 * The classic theme's About page (/about): the brand's words under the same
 * warm band as the home page's top, and a quiet way to the workshops. On the
 * Our story page (/story) the band is short, so the partners (tall portrait
 * cards side by side) start in the first screen.
 */
export function About({ data }: { data: AboutData }) {
  const { partners, labels } = data
  const story = data.page === "story"
  return (
    <>
      <section className="from-primary/8 border-b bg-linear-to-b to-transparent">
        <div
          className={cn(
            "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 mx-auto w-full max-w-6xl px-4 motion-safe:duration-500",
            story ? "grid gap-4 py-10 sm:py-12 md:grid-cols-2 md:items-end md:gap-12" : "py-14 sm:py-20",
          )}
        >
          <div>
            <p className="text-primary text-sm font-medium tracking-wide">{data.kicker}</p>
            <h1
              className={cn(
                "mt-3 font-serif [font-weight:var(--site-font-heading-weight)] tracking-wide text-balance rtl:tracking-normal",
                story ? "text-3xl sm:text-5xl" : "text-4xl sm:text-6xl",
              )}
            >
              {data.title}
            </h1>
          </div>
          <Paragraphs
            text={data.intro}
            className={cn("text-muted-foreground max-w-2xl leading-relaxed text-pretty", story ? "text-base sm:text-lg" : "mt-6 text-lg sm:text-xl")}
          />
        </div>
      </section>

      {partners.length > 0 && (
        <section aria-label={labels.partnersTitle} className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
          <ul
            className={cn(
              "grid gap-6 sm:gap-8",
              partners.length === 1 ? "max-w-xl" : "sm:grid-cols-2",
              partners.length >= 3 && "lg:grid-cols-3",
            )}
          >
            {partners.map((p, i) => (
              <li key={p.key}>
                <PartnerCard partner={p} alt={labels.portraitAlt(p.name)} priority={i === 0} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:pb-24">
        <div className="bg-primary/8 ring-primary/10 flex flex-col items-start gap-6 rounded-3xl p-7 ring-1 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div className="max-w-xl">
            <h2 className="font-serif text-2xl [font-weight:var(--site-font-heading-weight)] text-balance sm:text-3xl">{labels.ctaTitle}</h2>
            <p className="text-muted-foreground mt-2 text-base text-pretty sm:text-lg">{labels.ctaText}</p>
          </div>
          <Button asChild className="h-12 w-full shrink-0 rounded-xl px-6 text-base sm:w-auto">
            <Link href="/workshops">
              {labels.ctaButton}
              <ArrowRightIcon className="rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        </div>
      </section>
    </>
  )
}

/** A partner: the portrait (else their initial on clay), then their name, role and words. */
function PartnerCard({ partner: p, alt, priority }: { partner: AboutPartner; alt: string; priority: boolean }) {
  return (
    <article className="bg-card ring-foreground/8 motion-safe:animate-in motion-safe:fade-in-0 flex h-full flex-col overflow-hidden rounded-3xl shadow-xs ring-1 motion-safe:duration-700">
      <div className="bg-muted relative aspect-[4/5] overflow-hidden">
        {p.portraitUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
          <img
            src={p.portraitUrl}
            alt={alt}
            width={800}
            height={1000}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : undefined}
            decoding="async"
            style={{ objectPosition: "50% 30%" }}
            className="size-full object-cover"
          />
        ) : (
          <div aria-hidden className="from-primary/15 to-chart-3/20 flex size-full items-center justify-center bg-linear-to-br">
            <span className="text-primary/50 font-serif text-8xl [font-weight:var(--site-font-heading-weight)]">
              {Array.from(p.name.trim())[0] ?? ""}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-6 sm:p-8">
        <h2 className="font-serif text-2xl [font-weight:var(--site-font-heading-weight)] tracking-wide text-balance sm:text-3xl rtl:tracking-normal">
          {p.name}
        </h2>
        {p.role && <p className="text-primary mt-1.5 text-sm font-medium">{p.role}</p>}
        {p.bio && <Paragraphs text={p.bio} className="text-muted-foreground mt-4 text-base leading-relaxed text-pretty" />}
      </div>
    </article>
  )
}

/** Text as written: blank lines start a new paragraph, single line breaks are kept. */
function Paragraphs({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {text.split(/\n\s*\n/).map((para, i) => (
        <p key={i} className="whitespace-pre-line">
          {para.trim()}
        </p>
      ))}
    </div>
  )
}
