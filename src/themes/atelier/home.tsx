import { SparklesIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import type { CSSProperties } from "react"

import { Link } from "@/i18n/navigation"
import { formatDate, formatNumber } from "@/lib/format"
import type { HomeData, PublicCategory } from "../types"
import { HeroMedia, type HeroPhoto } from "./hero-media"
import { atelierPhotos, type AtelierPhoto } from "./photos"
import { PillLink } from "./pill"
import { RevealObserver } from "./reveal"
import { WorkshopCard } from "./workshop-card"

/**
 * Atelier's home page, after throttlehaus.ca: a full-screen hero under the
 * see-through header, the next workshops as framed prints, the story and the
 * crafts on rounded photo bands, past workshops, and "how it works" on a
 * full-width photo just above the footer. A section the admin hid (null) is
 * left out; so is one with nothing to show.
 */
export function Home({ data }: { data: HomeData }) {
  return (
    <>
      <Hero data={data} />
      <Upcoming data={data} />
      {data.story && <Story story={data.story} />}
      {data.crafts && data.categories.length > 0 && <Crafts crafts={data.crafts} categories={data.categories} />}
      {data.past && <Past past={data.past} locale={data.locale} />}
      {data.steps && data.steps.items.length > 0 && <Steps steps={data.steps} locale={data.locale} />}
      <RevealObserver />
    </>
  )
}

/** A stagger for the items of a row (`data-reveal` elements). */
const delay = (i: number, columns = 4): CSSProperties => ({ ["--reveal-delay" as string]: `${(i % columns) * 110}ms` })

/** A section photo: the admin's upload, else the theme's own (with its description). */
function useSectionPhoto(url: string | null, own: AtelierPhoto): HeroPhoto {
  const t = useTranslations("home.atelier.photos")
  return url ? { src: url, alt: "" } : { src: own.src, alt: t(own.alt), width: own.width, height: own.height, focus: own.focus }
}

/** A photo filling its (relative) section, behind the content. */
function Backdrop({ photo }: { photo: HeroPhoto }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- bundled or CDN photo, any size
    <img
      src={photo.src}
      alt={photo.alt}
      width={photo.width}
      height={photo.height}
      loading="lazy"
      decoding="async"
      style={{ objectPosition: photo.focus }}
      className="absolute inset-0 -z-20 size-full object-cover"
    />
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

/**
 * The whole first screen: the photos (or the video) behind a warm dark veil,
 * the brand as a small spaced-out line (the page's only h1), the big title,
 * one sentence and the way to the workshops. It slides under the header
 * (theme.css, `data-at-hero`), which stays see-through over it.
 */
function Hero({ data }: { data: HomeData }) {
  const t = useTranslations("home")
  const { hero, brand } = data
  const own = atelierPhotos.hero.map((p) => ({ ...p, alt: t(`atelier.photos.${p.alt}`) }))
  const photos: HeroPhoto[] =
    hero.media.kind === "images" ? hero.media.images.map((src) => ({ src, alt: t("hero.imageAlt") })) : own
  const video =
    hero.media.kind === "video"
      ? { url: hero.media.url, poster: hero.media.posterUrl ? { src: hero.media.posterUrl, alt: t("hero.imageAlt") } : own[0] }
      : undefined

  return (
    <section
      data-at-hero
      aria-labelledby="at-hero-brand"
      className="text-at-cream relative isolate flex min-h-svh flex-col items-center justify-center overflow-hidden bg-[#2a1912]"
    >
      <HeroMedia photos={photos} video={video} />
      {/* A warm veil: darker under the header, behind the words and at the bottom; the photo stays alive around them. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_52%,rgb(24_12_6/0.42),transparent),linear-gradient(180deg,rgb(24_12_6/0.62)_0%,rgb(30_16_9/0.36)_28%,rgb(30_16_9/0.4)_60%,rgb(24_12_6/0.75)_100%)]"
      />
      <div className="at-container flex flex-col items-center pt-(--at-bar-h) pb-20 text-center">
        <h1
          id="at-hero-brand"
          className="text-at-cream/90 inline-flex items-center gap-4 text-sm leading-none before:h-px before:w-8 before:bg-current before:opacity-50 after:h-px after:w-8 after:bg-current after:opacity-50 sm:text-base ltr:tracking-[0.42em]! ltr:after:-ms-[0.42em] rtl:text-lg"
        >
          {brand}
        </h1>
        <p className="at-heading mt-6 max-w-[14em] text-[36px] leading-[1.04] text-balance sm:mt-8 sm:text-[56px] lg:text-[68px] xl:text-[72px] rtl:text-[32px] rtl:leading-[1.5] sm:rtl:text-[48px] lg:rtl:text-[56px]">
          {hero.title}
        </p>
        {hero.subtitle && (
          <p className="text-at-cream/90 mt-6 max-w-[36rem] text-base text-pretty [text-shadow:0_1px_12px_rgb(0_0_0/0.35)] sm:mt-7 sm:text-lg">{hero.subtitle}</p>
        )}
        <PillLink href="/workshops" className="mt-9 sm:mt-11">
          {hero.button}
        </PillLink>
      </div>
      {/* A quiet hint that the page goes on. */}
      <span aria-hidden className="bg-at-cream/25 absolute bottom-7 left-1/2 h-12 w-px -translate-x-1/2 overflow-hidden">
        <span className="bg-at-cream block h-1/2 w-full motion-safe:animate-[at-scroll-cue_2.4s_ease-in-out_infinite]" />
      </span>
    </section>
  )
}

// ─── Upcoming workshops ──────────────────────────────────────────────────────

function Upcoming({ data }: { data: HomeData }) {
  const { upcoming, labels } = data
  return (
    <section aria-labelledby="at-upcoming" className="at-container py-16 sm:py-20 lg:py-24">
      <SectionHead id="at-upcoming" title={labels.upcomingTitle}>
        {upcoming.length > 0 && (
          <PillLink href="/workshops" tone="outline" size="sm" className="max-sm:hidden">
            {labels.allWorkshops}
          </PillLink>
        )}
      </SectionHead>

      {upcoming.length === 0 ? (
        <div data-reveal className="border-border bg-card/60 rounded-[32px] border px-6 py-16 text-center sm:py-20">
          <SparklesIcon className="text-at-khaki mx-auto size-6" aria-hidden />
          <p className="at-heading mt-5 text-2xl text-balance sm:text-3xl">{labels.emptyTitle}</p>
          <p className="text-muted-foreground mx-auto mt-3 max-w-md text-pretty">{labels.emptyText}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-8 sm:gap-y-8 lg:grid-cols-4 lg:gap-x-10 lg:gap-y-10">
          {upcoming.map((w, i) => (
            <li key={w.id} data-reveal style={delay(i)}>
              <WorkshopCard workshop={w} headingAs="h3" />
            </li>
          ))}
        </ul>
      )}
      {/* On a phone the way to all of them comes after the cards, full width. */}
      {upcoming.length > 0 && (
        <PillLink href="/workshops" tone="outline" className="mt-6 flex w-full sm:hidden">
          {labels.allWorkshops}
        </PillLink>
      )}
    </section>
  )
}

/** A section's small title on the start side, and its button (if any) on the end side. */
function SectionHead({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <div data-reveal data-reveal-fade className="mb-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 sm:mb-14">
      <h2 id={id} className="text-[22px] leading-tight sm:text-[28px] lg:text-[32px] rtl:text-2xl sm:rtl:text-[28px]">
        {title}
      </h2>
      {children}
    </div>
  )
}

// ─── Story ───────────────────────────────────────────────────────────────────

function Story({ story }: { story: NonNullable<HomeData["story"]> }) {
  const photo = useSectionPhoto(story.imageUrl, atelierPhotos.story)
  return (
    <section aria-labelledby="at-story" className="at-container py-4 sm:py-6">
      <div
        data-reveal
        className="bg-at-deep relative isolate flex min-h-[560px] items-end overflow-hidden rounded-[32px] sm:min-h-[600px] md:items-center lg:min-h-[650px] lg:rounded-[48px]"
      >
        <Backdrop photo={photo} />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-linear-to-t from-[rgb(26_13_7/0.9)] via-[rgb(26_13_7/0.5)] to-[rgb(26_13_7/0.05)] md:bg-linear-to-r md:from-[rgb(26_13_7/0.85)] md:via-[rgb(26_13_7/0.45)] md:to-transparent rtl:md:bg-linear-to-l"
        />
        <div className="text-at-cream max-w-[36rem] p-7 sm:p-12 lg:p-16">
          <h2 id="at-story" className="text-[32px] leading-[1.05] text-balance sm:text-[44px] lg:text-[52px] rtl:leading-[1.5]">
            {story.title}
          </h2>
          <p className="text-at-cream/90 mt-5 text-base text-pretty sm:mt-6 sm:text-lg">{story.text}</p>
          <PillLink href="/workshops" className="mt-8 sm:mt-10">
            {story.button}
          </PillLink>
        </div>
      </div>
    </section>
  )
}

// ─── Explore by craft ────────────────────────────────────────────────────────

function Crafts({ crafts, categories }: { crafts: NonNullable<HomeData["crafts"]>; categories: PublicCategory[] }) {
  const photo = useSectionPhoto(crafts.imageUrl, atelierPhotos.crafts)
  return (
    <section aria-labelledby="at-crafts" className="at-container py-4 sm:py-6">
      <div
        data-reveal
        className="bg-at-deep relative isolate flex min-h-[460px] flex-col items-center justify-center overflow-hidden rounded-[32px] px-6 py-16 text-center sm:min-h-[480px] lg:min-h-[540px] lg:rounded-[48px]"
      >
        <Backdrop photo={photo} />
        <div aria-hidden className="absolute inset-0 -z-10 bg-[rgb(26_13_7/0.52)]" />
        <h2 id="at-crafts" className="text-at-cream text-[32px] leading-[1.05] text-balance sm:text-[44px] lg:text-[52px] rtl:leading-[1.5]">
          {crafts.title}
        </h2>
        <ul className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:mt-10 sm:max-w-3xl sm:flex-row sm:flex-wrap sm:justify-center sm:gap-4">
          {categories.map((c) => (
            <li key={c.slug} className="flex flex-col">
              <PillLink href={{ pathname: "/workshops", query: { category: c.slug } }}>{c.name}</PillLink>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ─── Past workshops ──────────────────────────────────────────────────────────

function Past({ past, locale }: { past: NonNullable<HomeData["past"]>; locale: string }) {
  const items = past.workshops.flatMap((w) => {
    const url = w.coverUrl ?? w.photos[0]?.url
    return url ? [{ w, url }] : []
  })
  if (items.length === 0) return null

  return (
    <section aria-labelledby="at-past" className="at-container py-16 sm:py-20 lg:py-24">
      <SectionHead id="at-past" title={past.title} />
      <ul className="grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-8 sm:gap-y-14 lg:grid-cols-4 lg:gap-x-10 lg:gap-y-16">
        {items.map(({ w, url }, i) => (
          <li key={w.slug} data-reveal style={delay(i)}>
            <Link
              href={`/workshops/${w.slug}`}
              className="group focus-visible:ring-ring/50 focus-visible:ring-offset-background flex flex-col rounded-[20px] pb-2 text-center outline-none focus-visible:ring-3 focus-visible:ring-offset-4"
            >
              <div className="bg-at-frame aspect-[4/5] p-1.5 shadow-[0_18px_36px_-22px_rgb(91_49_30/0.55)] sm:p-2">
                <div className="bg-muted size-full overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host */}
                  <img
                    src={url}
                    alt=""
                    width={800}
                    height={1000}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                  />
                </div>
              </div>
              <h3 className="mt-5 text-lg leading-snug text-balance sm:mt-6 sm:text-[22px] sm:leading-tight">{w.title}</h3>
              <p className="text-muted-foreground mt-1.5 text-[13px] sm:text-sm">{formatDate(w.startsAt, locale, "long")}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── How it works ────────────────────────────────────────────────────────────

function Steps({ steps, locale }: { steps: NonNullable<HomeData["steps"]>; locale: string }) {
  const photo = useSectionPhoto(steps.imageUrl, atelierPhotos.steps)
  return (
    <section
      aria-labelledby="at-steps"
      className="bg-at-deep relative isolate mt-10 overflow-hidden py-20 sm:mt-16 sm:py-28 lg:py-32"
    >
      <Backdrop photo={photo} />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[rgb(26_13_7/0.6)]" />
      <div className="at-container">
        <h2
          id="at-steps"
          data-reveal
          className="text-at-cream text-center text-[32px] leading-[1.05] text-balance sm:text-[44px] lg:text-[52px] rtl:leading-[1.5]"
        >
          {steps.title}
        </h2>
        <ol className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2 sm:gap-5 lg:mt-16 lg:grid-cols-4 lg:gap-6">
          {steps.items.map((step, i) => (
            <li
              key={i}
              data-reveal
              style={delay(i)}
              className="bg-card text-card-foreground flex flex-col rounded-2xl p-5 shadow-[0_24px_48px_-28px_rgb(0_0_0/0.6)] sm:p-7"
            >
              <span aria-hidden className="at-heading text-primary text-[32px] leading-none sm:text-[40px]">
                {formatNumber(i + 1, locale, { minimumIntegerDigits: 2 })}
              </span>
              <h3 className="mt-3 text-xl leading-snug sm:mt-5 sm:text-[22px]">{step.title}</h3>
              <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed text-pretty">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
