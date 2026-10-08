import {
  CalendarDaysIcon,
  CalendarX2Icon,
  ChevronLeftIcon,
  ClockIcon,
  HourglassIcon,
  MapPinIcon,
  PaletteIcon,
  PartyPopperIcon,
  TicketIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { Button } from "@/components/ui/button"
import { PaymentBadge } from "@/features/registrations/components/payment-badge"
import { getPublicWorkshop, myActiveRegistrations, type PublicWorkshop } from "@/features/registrations/public"
import { Link } from "@/i18n/navigation"
import { absoluteLocaleUrl, localeHref } from "@/i18n/links"
import { formatDate, formatDateTime, formatTimeRange } from "@/lib/format"
import { absoluteUrl, alternates, jsonLdText, ogLocale } from "@/lib/seo"
import { getBrand } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { AgeLabel, AvailabilityBadge, Price } from "@/components/site/workshop-labels"

/** Search engines get a summary of at most this many characters. */
const DESCRIPTION_MAX = 160

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`

export async function generateMetadata({ params }: PageProps<"/[locale]/workshops/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params
  const w = await getPublicWorkshop(slug, locale)
  if (!w) return {}
  const [t, brand] = await Promise.all([getTranslations({ locale, namespace: "registration.workshop" }), getBrand(locale)])
  const description = clip(
    w.intro.replace(/\s+/g, " ") ||
      t("metaDescription", { title: w.title, date: formatDate(w.startsAt, locale, "long"), venue: w.venue, brand }),
    DESCRIPTION_MAX,
  )
  const links = await alternates(`/workshops/${w.slug}`, locale)
  // Only bookable or past workshops are worth indexing.
  const indexable = w.window !== "cancelled" && w.window !== "paused"
  return {
    title: w.title,
    description,
    alternates: links,
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: {
      type: "website",
      title: w.title,
      description,
      url: links.canonical,
      siteName: brand,
      locale: ogLocale[locale],
      images: w.coverUrl ? [{ url: absoluteUrl(w.coverUrl), alt: w.title }] : undefined,
    },
  }
}

/** A workshop's page: everything about it, and one big "Register" button while places are open. */
export default async function WorkshopPage({ params }: PageProps<"/[locale]/workshops/[slug]">) {
  const { locale, slug } = await params
  const w = await getPublicWorkshop(slug, locale)
  if (!w) notFound()
  const [t, brand, mine] = await Promise.all([
    getTranslations("registration.workshop"),
    getBrand(locale),
    myActiveRegistrations(w.id),
  ])
  const canonical = absoluteUrl(await localeHref(locale, `/workshops/${w.slug}`))

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: w.title,
    ...(w.intro ? { description: w.intro } : {}),
    startDate: w.startsAt.toISOString(),
    endDate: w.endsAt.toISOString(),
    eventStatus: `https://schema.org/${w.window === "cancelled" ? "EventCancelled" : "EventScheduled"}`,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    inLanguage: locale,
    url: canonical,
    location: { "@type": "Place", name: w.venue, address: w.venue },
    ...(w.coverUrl || w.samples.length
      ? { image: [w.coverUrl, ...w.samples.map((s) => s.url)].filter(Boolean).map((u) => absoluteUrl(u!)) }
      : {}),
    organizer: { "@type": "Organization", name: brand, url: await absoluteLocaleUrl(locale, "/") },
    ...(w.instructor.name ? { performer: { "@type": "Person", name: w.instructor.name } } : {}),
    ...(w.ageMin !== null && w.ageMax !== null ? { typicalAgeRange: `${w.ageMin}-${w.ageMax}` } : {}),
    offers: {
      "@type": "Offer",
      price: (w.price / 100).toFixed(2),
      priceCurrency: "TRY",
      url: canonical,
      validThrough: w.registrationDeadline.toISOString(),
      availability: `https://schema.org/${w.window === "open" ? "InStock" : "SoldOut"}`,
    },
  }

  return (
    <article className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:pt-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />

      <Link
        href="/workshops"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mb-5 inline-flex h-10 items-center gap-1 rounded-md text-sm outline-none focus-visible:ring-3"
      >
        <ChevronLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("back")}
      </Link>

      <div className="bg-muted relative mb-8 aspect-[16/10] overflow-hidden rounded-3xl sm:aspect-[21/9]">
        {w.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
          <img src={w.coverUrl} alt="" fetchPriority="high" className="size-full object-cover" />
        ) : (
          <div className="from-primary/15 to-chart-3/20 flex size-full items-center justify-center bg-linear-to-br">
            <PaletteIcon className="text-primary/50 size-16" aria-hidden />
          </div>
        )}
      </div>

      {/* Two rows beside the aside: header (as tall as it is) and the rest, so a tall aside never pushes the content down. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-12">
        <header className="space-y-2 lg:col-start-1">
          {w.category && <p className="text-primary text-sm font-medium">{w.category}</p>}
          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl rtl:tracking-normal">
            {w.title}
          </h1>
          {w.instructor.name && <p className="text-muted-foreground text-base">{t("by", { name: w.instructor.name })}</p>}
        </header>

        <aside className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <Facts workshop={w} locale={locale} />
          <div className="mt-4">
            {mine.length > 0 ? (
              <Registered workshop={w} registrations={mine} />
            ) : w.window === "open" ? (
              <Register slug={w.slug} />
            ) : (
              <ClosedState workshop={w} locale={locale} />
            )}
          </div>
        </aside>

        <div className="space-y-10 lg:col-start-1">
          {w.intro && (
            <Section title={t("about")}>
              <Paragraphs text={w.intro} />
            </Section>
          )}
          {w.includes && (
            <Section title={t("includes")}>
              <Paragraphs text={w.includes} />
            </Section>
          )}
          <Section title={t("bring")}>{w.bring ? <Paragraphs text={w.bring} /> : <p>{t("bringNothing")}</p>}</Section>
          <Section title={t("experience")}>
            {w.experienceRequired ? (
              <>
                <p>{t("experienceNeeded")}</p>
                {w.experienceNote && <Paragraphs text={w.experienceNote} />}
              </>
            ) : (
              <p>{t("noExperience")}</p>
            )}
          </Section>
          {w.notes && (
            <Section title={t("notes")}>
              <Paragraphs text={w.notes} />
            </Section>
          )}
          {w.samples.length > 0 && (
            <Section title={t("samples")}>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {w.samples.map((s, i) => (
                  <li key={s.url} className="bg-muted aspect-square overflow-hidden rounded-2xl">
                    {/* eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host */}
                    <img
                      src={s.url}
                      alt={t("sampleAlt", { n: i + 1 })}
                      loading="lazy"
                      width={s.width ?? undefined}
                      height={s.height ?? undefined}
                      className="size-full object-cover"
                    />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {w.instructor.name && (
            <Section title={t("instructor")}>
              <div className="flex items-start gap-4">
                {w.instructor.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
                  <img
                    src={w.instructor.photoUrl}
                    alt=""
                    loading="lazy"
                    className="bg-muted size-20 shrink-0 rounded-full object-cover sm:size-24"
                  />
                ) : (
                  <span className="bg-primary/10 text-primary flex size-20 shrink-0 items-center justify-center rounded-full text-2xl font-semibold sm:size-24">
                    {w.instructor.name.charAt(0)}
                  </span>
                )}
                <div className="min-w-0 space-y-1">
                  <p className="text-lg font-semibold">{w.instructor.name}</p>
                  {w.instructor.field && <p className="text-primary text-sm">{w.instructor.field}</p>}
                  {w.instructor.bio && <Paragraphs text={w.instructor.bio} className="text-muted-foreground pt-1" />}
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>

      {mine.length === 0 && w.window === "open" && <PhoneRegisterBar workshop={w} />}
    </article>
  )
}

/** Date, time, place, who it's for, price and places, in one calm card. */
async function Facts({ workshop: w, locale }: { workshop: PublicWorkshop; locale: string }) {
  const t = await getTranslations("registration.workshop.facts")
  const rows: { icon: LucideIcon; label: string; value: React.ReactNode }[] = [
    { icon: CalendarDaysIcon, label: t("date"), value: formatDate(w.startsAt, locale, "full") },
    { icon: ClockIcon, label: t("time"), value: <bdi>{formatTimeRange(w.startsAt, w.endsAt, locale)}</bdi> },
    { icon: MapPinIcon, label: t("venue"), value: w.venue },
    { icon: UsersRoundIcon, label: t("age"), value: <AgeLabel ageMin={w.ageMin} ageMax={w.ageMax} /> },
  ]
  return (
    <div className="bg-card ring-foreground/8 rounded-2xl p-5 shadow-sm ring-1">
      <dl className="space-y-3.5">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground flex items-center gap-2 text-xs">
              <Icon className="text-primary size-4 shrink-0" aria-hidden />
              {label}
            </dt>
            <dd className="ms-6 mt-0.5 text-[0.95rem] font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4">
        <span>
          <span className="sr-only">{t("price")}: </span>
          <Price value={w.price} className="text-2xl" />
        </span>
        <span>
          <span className="sr-only">{t("seats")}: </span>
          <AvailabilityBadge window={w.window} seatsLeft={w.seatsLeft} />
        </span>
      </div>
      {w.window === "open" && (
        <p className="text-muted-foreground mt-3 text-xs">
          {t("deadline")}: {formatDateTime(w.registrationDeadline, locale, "long")}
        </p>
      )}
    </div>
  )
}

/** The one main action: register (with a short reassurance under it). */
async function Register({ slug }: { slug: string }) {
  const t = await getTranslations("registration.workshop")
  return (
    <div className="space-y-2.5">
      <Button asChild className="h-14 w-full rounded-2xl text-lg shadow-sm">
        <Link href={`/workshops/${slug}/register`}>
          <TicketIcon className="size-5" aria-hidden />
          {t("register")}
        </Link>
      </Button>
      <p className="text-muted-foreground text-center text-sm">{t("registerHint")}</p>
    </div>
  )
}

/**
 * Phones: the price and "Register" kept at the bottom of the screen while the
 * page is read (the aside's button is below the cover and the facts there).
 * Sticky at the end of the article, so it never covers the footer.
 */
async function PhoneRegisterBar({ workshop: w }: { workshop: PublicWorkshop }) {
  const t = await getTranslations("registration.workshop")
  return (
    <div className="bg-background/95 sticky bottom-0 z-30 -mx-4 mt-10 border-t px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      <div className="flex items-center gap-3">
        <Price value={w.price} className="text-xl" />
        <Button asChild className="h-12 flex-1 rounded-xl text-base">
          <Link href={`/workshops/${w.slug}/register`}>
            <TicketIcon className="size-5" aria-hidden />
            {t("register")}
          </Link>
        </Button>
      </div>
    </div>
  )
}

/** "You are registered", with each participant's payment status. */
async function Registered({
  workshop: w,
  registrations,
}: {
  workshop: PublicWorkshop
  registrations: Awaited<ReturnType<typeof myActiveRegistrations>>
}) {
  const t = await getTranslations("registration.workshop.registered")
  return (
    <div className="border-success/30 bg-success/8 space-y-4 rounded-2xl border p-5">
      <div className="flex items-start gap-3">
        <PartyPopperIcon className="text-success mt-0.5 size-6 shrink-0" aria-hidden />
        <div>
          <p className="text-lg font-semibold">{t("title")}</p>
          <p className="text-muted-foreground text-sm">{t("text", { count: registrations.length })}</p>
        </div>
      </div>
      <ul className="space-y-2">
        {registrations.map((r) => (
          <li key={r.id} className="bg-background/70 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5">
            <span className="font-medium">{r.participantName}</span>
            <PaymentBadge registration={{ ...r, refundAmount: null, refundedAt: null }} />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <Button asChild className="h-12 rounded-xl text-base">
          <Link href={registrations.length === 1 ? `/account/registrations/${registrations[0].id}` : "/account"}>
            {t("myWorkshops")}
          </Link>
        </Button>
        {w.window === "open" && (
          <Button asChild variant="ghost" className="h-11 rounded-xl text-sm">
            <Link href={`/workshops/${w.slug}/register`}>{t("another")}</Link>
          </Button>
        )}
      </div>
    </div>
  )
}

const stateIcons = {
  full: UsersRoundIcon,
  closed: HourglassIcon,
  started: ClockIcon,
  past: CalendarDaysIcon,
  cancelled: CalendarX2Icon,
  paused: HourglassIcon,
} as const

/** Full, closed, started, past, cancelled or paused: said kindly, with a way on. */
async function ClosedState({ workshop: w, locale }: { workshop: PublicWorkshop; locale: string }) {
  const t = await getTranslations("registration.workshop")
  const state = w.window === "open" ? "full" : w.window
  const Icon = stateIcons[state]
  return (
    <div className="bg-muted/60 space-y-3 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <Icon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold">{t(`state.${state}Title`)}</p>
          <p className="text-muted-foreground text-sm text-pretty">
            {t(`state.${state}Text`, { date: formatDateTime(w.registrationDeadline, locale, "long") })}
          </p>
        </div>
      </div>
      <Button asChild variant="outline" className="h-12 w-full rounded-xl text-base">
        <Link href="/workshops">{t("allWorkshops")}</Link>
      </Button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="text-foreground/90 space-y-3 text-base leading-relaxed text-pretty">{children}</div>
    </section>
  )
}

/** Admin-written text: blank lines start a new paragraph, single line breaks are kept. */
function Paragraphs({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p.trim()}
        </p>
      ))}
    </div>
  )
}
