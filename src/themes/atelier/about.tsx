import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AboutData, AboutPartner } from "../types"
import { Backdrop, delay, useSectionPhoto } from "./home"
import { atelierPhotos } from "./photos"
import { PillLink } from "./pill"
import { RevealObserver } from "./reveal"
import { Monogram } from "./workshop-card"

/**
 * Atelier's About page: a quiet, centred opening (the kicker between two
 * rules, the title, the brand's story), each partner as a framed portrait
 * print beside their words, the sides changing from one partner to the next,
 * and the story band's photo closing the page with the way to the workshops.
 */
export function About({ data }: { data: AboutData }) {
  if (data.page === "story") return <Story data={data} />
  const { partners, labels } = data
  return (
    <>
      <section className="at-container pt-16 pb-14 text-center sm:pt-24 sm:pb-20 lg:pt-28">
        <p
          data-reveal
          data-reveal-fade
          className="text-muted-foreground at-caps inline-flex items-center gap-4 text-xs before:h-px before:w-8 before:bg-current before:opacity-50 after:h-px after:w-8 after:bg-current after:opacity-50 sm:text-[13px] rtl:text-sm"
        >
          {data.kicker}
        </p>
        <h1
          data-reveal
          className="at-heading mx-auto mt-6 max-w-[16em] text-[40px] leading-[1.04] text-balance sm:mt-8 sm:text-[56px] lg:text-[72px] rtl:text-[34px] rtl:leading-[1.5] sm:rtl:text-[48px] lg:rtl:text-[56px]"
        >
          {data.title}
        </h1>
        <div data-reveal style={delay(1)} className="text-muted-foreground mx-auto mt-7 max-w-[42rem] space-y-4 text-lg leading-relaxed text-pretty sm:mt-9">
          {paragraphs(data.intro).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>
        <span aria-hidden className="bg-at-beige/70 mx-auto mt-12 block h-16 w-px sm:mt-16 sm:h-20" />
      </section>

      {partners.length > 0 && (
        <section aria-labelledby="at-about-team" className="at-container pb-20 sm:pb-28">
          <div className="mx-auto max-w-[40rem] text-center" data-reveal data-reveal-fade>
            <h2 id="at-about-team" className="text-[26px] leading-tight sm:text-[34px] lg:text-[40px] rtl:text-[26px] sm:rtl:text-[32px]">
              {labels.partnersTitle}
            </h2>
          </div>
          <ol className="mt-14 space-y-20 sm:mt-20 sm:space-y-28 lg:space-y-32">
            {partners.map((p, i) => (
              <li key={p.key}>
                <Partner partner={p} index={i} locale={data.locale} alt={labels.portraitAlt(p.name)} />
              </li>
            ))}
          </ol>
        </section>
      )}

      <Closing data={data} />
      <RevealObserver />
    </>
  )
}

/**
 * Atelier's Our story page: a short, quiet opening (the brand between two rules,
 * the title, one line) so the partners are on the first screen, then each
 * partner as a framed portrait beside their number, role, name and words, and
 * the same closing band.
 */
function Story({ data }: { data: AboutData }) {
  const { partners, labels } = data
  return (
    <>
      <section className="at-container pt-12 pb-10 text-center sm:pt-16 sm:pb-12">
        <p
          data-reveal
          data-reveal-fade
          className="text-muted-foreground at-caps inline-flex items-center gap-3 text-[11px] before:h-px before:w-6 before:bg-current before:opacity-50 after:h-px after:w-6 after:bg-current after:opacity-50 sm:text-xs rtl:text-[13px]"
        >
          {data.kicker}
        </p>
        <h1
          data-reveal
          className="at-heading mx-auto mt-4 max-w-[18em] text-[30px] leading-[1.1] text-balance sm:text-[40px] rtl:text-[26px] rtl:leading-[1.6] sm:rtl:text-[32px]"
        >
          {data.title}
        </h1>
        <p data-reveal style={delay(1)} className="text-muted-foreground mx-auto mt-3 max-w-[36rem] text-[15px] leading-relaxed text-pretty sm:text-base">
          {data.intro}
        </p>
      </section>

      {partners.length > 0 && (
        <section aria-labelledby="at-story-team" className="at-container pb-20 sm:pb-24">
          <h2
            id="at-story-team"
            data-reveal
            data-reveal-fade
            className="at-caps text-muted-foreground flex items-center gap-4 text-[11px] before:h-px before:flex-1 before:bg-current before:opacity-25 after:h-px after:flex-1 after:bg-current after:opacity-25 sm:text-xs rtl:text-[13px]"
          >
            {labels.partnersTitle}
          </h2>
          <ul className="divide-at-beige/50 mx-auto mt-6 max-w-4xl divide-y sm:mt-8">
            {partners.map((p, i) => (
              <li key={p.key} data-reveal style={delay(i)} className="py-8 sm:py-10">
                <StoryPartner partner={p} index={i} locale={data.locale} alt={labels.portraitAlt(p.name)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Closing data={data} />
      <RevealObserver />
    </>
  )
}

/** A partner on Our story: a framed portrait beside the number and role on one small line, the name and their words. */
function StoryPartner({ partner: p, index, locale, alt }: { partner: AboutPartner; index: number; locale: string; alt: string }) {
  return (
    <article className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <figure className="w-full">
        <div className="bg-at-frame aspect-[4/5] p-1 shadow-[0_20px_40px_-28px_rgb(91_49_30/0.55)] sm:p-1.5">
          <div className="bg-muted relative size-full overflow-hidden">
            {p.portraitUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
              <img
                src={p.portraitUrl}
                alt={alt}
                width={560}
                height={700}
                loading={index < 2 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : undefined}
                decoding="async"
                style={{ objectPosition: "50% 30%" }}
                className="size-full object-cover"
              />
            ) : (
              <Monogram title={p.name} />
            )}
          </div>
        </div>
      </figure>
      <div className="min-w-0 sm:pt-2">
        <p className="at-caps text-muted-foreground flex flex-wrap items-center gap-x-2 text-[11px] sm:text-xs rtl:text-[13px]">
          <span className="text-primary">{formatNumber(index + 1, locale, { minimumIntegerDigits: 2 })}</span>
          {p.role && (
            <>
              <span aria-hidden className="h-px w-4 bg-current opacity-50" />
              <span>{p.role}</span>
            </>
          )}
        </p>
        <h3 className="mt-2 text-[22px] leading-[1.2] text-balance sm:text-[28px] rtl:text-[20px] rtl:leading-[1.6] sm:rtl:text-[24px]">{p.name}</h3>
        {p.bio && (
          <div className="text-muted-foreground mt-3 space-y-3 text-[15px] leading-relaxed text-pretty sm:mt-4 sm:text-base">
            {paragraphs(p.bio).map((para, i) => (
              <p key={i} className="whitespace-pre-line">
                {para}
              </p>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/** One partner: the framed portrait on one side, the number, name, role and words on the other (every second partner the other way round). */
function Partner({ partner: p, index, locale, alt }: { partner: AboutPartner; index: number; locale: string; alt: string }) {
  const flipped = index % 2 === 1
  return (
    <article className="grid items-center gap-10 md:grid-cols-2 md:gap-14 lg:gap-24">
      <figure data-reveal className={cn("mx-auto w-full max-w-[26rem]", flipped && "md:order-2")}>
        <div className="bg-at-frame aspect-[4/5] p-1.5 shadow-[0_28px_56px_-30px_rgb(91_49_30/0.6)] sm:p-2">
          <div className="bg-muted relative size-full overflow-hidden">
            {p.portraitUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
              <img
                src={p.portraitUrl}
                alt={alt}
                width={800}
                height={1000}
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : undefined}
                decoding="async"
                style={{ objectPosition: "50% 30%" }}
                className="size-full object-cover"
              />
            ) : (
              <Monogram title={p.name} />
            )}
          </div>
        </div>
      </figure>
      <div data-reveal style={delay(1)} className={cn("min-w-0 text-center md:text-start", flipped && "md:order-1")}>
        <span aria-hidden className="at-heading text-primary text-[32px] leading-none sm:text-[40px]">
          {formatNumber(index + 1, locale, { minimumIntegerDigits: 2 })}
        </span>
        <h3 className="mt-4 text-[32px] leading-[1.08] text-balance sm:mt-6 sm:text-[44px] rtl:text-[30px] rtl:leading-[1.5] sm:rtl:text-[38px]">
          {p.name}
        </h3>
        {p.role && <p className="at-caps text-muted-foreground mt-3 text-xs sm:text-[13px] rtl:text-sm">{p.role}</p>}
        {p.bio && (
          <div className="border-at-beige/60 mt-6 space-y-4 border-t pt-6 text-[17px] leading-relaxed text-pretty sm:mt-8 sm:pt-8">
            {paragraphs(p.bio).map((para, i) => (
              <p key={i} className="whitespace-pre-line">
                {para}
              </p>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/** The page's end: the story band's photo behind a warm veil, a line and the way to the workshops. */
function Closing({ data }: { data: AboutData }) {
  const photo = useSectionPhoto(data.storyImageUrl, atelierPhotos.story)
  return (
    <section aria-labelledby="at-about-cta" className="at-container pb-16 sm:pb-20">
      <div
        data-reveal
        className="bg-at-deep relative isolate flex min-h-[420px] items-center justify-center overflow-hidden rounded-[32px] text-center sm:min-h-[480px] lg:rounded-[48px]"
      >
        <Backdrop photo={photo} />
        <div aria-hidden className="absolute inset-0 -z-10 bg-[rgb(26_13_7/0.62)]" />
        <div className="text-at-cream max-w-[46rem] p-8 sm:p-12">
          <h2 id="at-about-cta" className="text-[32px] leading-[1.05] text-balance sm:text-[44px] lg:text-[52px] rtl:leading-[1.5]">
            {data.labels.ctaTitle}
          </h2>
          <p className="text-at-cream/90 mt-5 text-base text-pretty sm:text-lg">{data.labels.ctaText}</p>
          <PillLink href="/workshops" className="mt-8 sm:mt-10">
            {data.labels.ctaButton}
          </PillLink>
        </div>
      </div>
    </section>
  )
}

/** Text as written: blank lines start a new paragraph. */
const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
