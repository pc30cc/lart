import { ArrowRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import type { AboutData, AboutPartner } from "../types"

/**
 * The classic theme's About page: the brand's story under the same warm band
 * as the home page's top, the partners as tall portrait cards side by side,
 * and a quiet way to the workshops. Without partners on the page, the story
 * and the way to the workshops stay.
 */
export function About({ data }: { data: AboutData }) {
  const { partners, labels } = data
  return (
    <>
      <section className="from-primary/8 border-b bg-linear-to-b to-transparent">
        <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 mx-auto w-full max-w-6xl px-4 py-14 motion-safe:duration-500 sm:py-20">
          <p className="text-primary text-sm font-medium tracking-wide">{data.kicker}</p>
          <h1 className="mt-3 font-serif text-4xl [font-weight:var(--site-font-heading-weight)] tracking-wide text-balance sm:text-6xl rtl:tracking-normal">
            {data.title}
          </h1>
          <Paragraphs text={data.intro} className="text-muted-foreground mt-6 max-w-2xl text-lg leading-relaxed text-pretty sm:text-xl" />
        </div>
      </section>

      {partners.length > 0 && (
        <section aria-labelledby="about-team" className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-20">
          <div className="max-w-2xl">
            <h2 id="about-team" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {labels.partnersTitle}
            </h2>
            <p className="text-muted-foreground mt-2 text-base text-pretty sm:text-lg">{labels.partnersText}</p>
          </div>
          <ul
            className={cn(
              "mt-10 grid gap-6 sm:mt-12 sm:gap-8",
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
        <h3 className="font-serif text-2xl [font-weight:var(--site-font-heading-weight)] tracking-wide text-balance sm:text-3xl rtl:tracking-normal">
          {p.name}
        </h3>
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
