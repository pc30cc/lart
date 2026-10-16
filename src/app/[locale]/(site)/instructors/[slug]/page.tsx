import { AwardIcon, CalendarDaysIcon, ChevronLeftIcon, FileTextIcon, LanguagesIcon, PaletteIcon, ShieldCheckIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { getPublicInstructor, type PublicInstructor } from "@/features/instructor-documents/queries"
import { languageName } from "@/features/instructors/schema"
import { formatWorkshopDates } from "@/features/workshops/days"
import { Link } from "@/i18n/navigation"
import { isRtl } from "@/i18n/locales"
import { pageLocale } from "@/i18n/page-locale"
import { getBrand } from "@/lib/settings"
import { cn } from "@/lib/utils"

/** Never in search engines: a person's page, reached from their workshops only (not in the sitemap either). */
const NOT_INDEXED: Metadata["robots"] = { index: false, follow: true, nocache: true, googleBot: { index: false, follow: true, noimageindex: true } }

export async function generateMetadata({ params }: PageProps<"/[locale]/instructors/[slug]">): Promise<Metadata> {
  const { locale: raw, slug } = await params
  const locale = pageLocale(raw)
  const person = await getPublicInstructor(slug, locale)
  if (!person) notFound()
  const t = await getTranslations({ locale, namespace: "site.instructorProfile" })
  return { title: t("metaTitle", { name: person.name }), robots: NOT_INDEXED }
}

/**
 * An instructor's page (/instructors/[slug]), opened from "About the
 * instructor" on their workshops and from the instructors list: who they are, their certificates and
 * licences as small marked copies (enough to see what they are, too small to
 * reuse) with their details, and the workshops they gave here. Not indexed.
 */
export default async function InstructorProfilePage({ params }: PageProps<"/[locale]/instructors/[slug]">) {
  const { locale: raw, slug } = await params
  const locale = pageLocale(raw)
  const person = await getPublicInstructor(slug, locale)
  if (!person) notFound()
  const [t, brand] = await Promise.all([getTranslations("site.instructorProfile"), getBrand(locale)])
  const held = person.workshops.filter((w) => w.held)
  const coming = person.workshops.filter((w) => !w.held)

  return (
    <article className="mx-auto w-full max-w-5xl px-4 pt-6 pb-16 sm:pt-8">
      <Link
        href="/instructors"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mb-6 inline-flex h-10 items-center gap-1 rounded-md text-sm outline-none focus-visible:ring-3"
      >
        <ChevronLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("back")}
      </Link>

      <header className="bg-card ring-foreground/5 relative overflow-hidden rounded-3xl border p-6 shadow-xs ring-1 sm:p-10">
        <div className="from-primary/10 pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b to-transparent" aria-hidden />
        <div className="relative flex flex-col items-center gap-6 text-center sm:flex-row sm:items-start sm:text-start">
          {person.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
            <img src={person.photoUrl} alt="" className="bg-muted ring-background size-32 shrink-0 rounded-full object-cover shadow-md ring-4 sm:size-36" />
          ) : (
            <span className="bg-primary/10 text-primary ring-background flex size-32 shrink-0 items-center justify-center rounded-full text-4xl font-semibold ring-4 sm:size-36">
              {person.name.charAt(0)}
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-3">
            <div className="space-y-1">
              <p className="text-primary text-sm font-medium">{t("eyebrow", { brand })}</p>
              <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl rtl:tracking-normal">{person.name}</h1>
              {person.field && (
                <p className="text-muted-foreground text-lg">
                  {/* bdi: a field in another language keeps its own direction without moving to the other side. */}
                  <bdi {...langProps(person.fieldLang)}>{person.field}</bdi>
                </p>
              )}
            </div>
            <ul className="flex flex-wrap justify-center gap-2 sm:justify-start">
              {person.workshops.length > 0 && (
                <Chip icon={CalendarDaysIcon}>{t("workshopsCount", { count: person.workshops.length })}</Chip>
              )}
              {person.documents.length > 0 && (
                <Chip icon={AwardIcon}>{t("documentsCount", { count: person.documents.length })}</Chip>
              )}
              {person.teachingLanguages.length > 0 && (
                <Chip icon={LanguagesIcon}>{person.teachingLanguages.map((c) => languageName(c, locale)).join(t("listSeparator"))}</Chip>
              )}
            </ul>
          </div>
        </div>
        {person.bio && <Paragraphs text={person.bio} lang={person.bioLang} className="text-foreground/85 relative mt-8 border-t pt-6 text-base leading-relaxed" />}
      </header>

      {person.documents.length > 0 && (
        <Section title={t("documents.title")} description={t("documents.description")} icon={AwardIcon}>
          <ul className="grid gap-4 sm:grid-cols-2">
            {person.documents.map((d) => (
              <DocumentCard key={d.id} doc={d} pdfLabel={t("documents.pdf")} />
            ))}
          </ul>
          <p className="text-muted-foreground flex items-start gap-2 text-xs text-pretty">
            <ShieldCheckIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            {t("documents.note", { brand })}
          </p>
        </Section>
      )}

      {coming.length > 0 && (
        <Section title={t("coming")} icon={CalendarDaysIcon}>
          <WorkshopList workshops={coming} locale={locale} />
        </Section>
      )}
      {(held.length > 0 || coming.length === 0) && (
        <Section title={t("held", { brand })} icon={PaletteIcon}>
          {held.length > 0 ? <WorkshopList workshops={held} locale={locale} done={t("heldBadge")} /> : <p className="text-muted-foreground text-sm">{t("noneHeld")}</p>}
        </Section>
      )}
    </article>
  )
}

function Chip({ icon: Icon, children }: { icon: typeof AwardIcon; children: React.ReactNode }) {
  return (
    <li className="bg-muted/70 text-foreground/80 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm">
      <Icon className="text-primary size-3.5" aria-hidden />
      {children}
    </li>
  )
}

function Section({ title, description, icon: Icon, children }: { title: string; description?: string; icon: typeof AwardIcon; children: React.ReactNode }) {
  return (
    <section className="mt-12 space-y-5">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Icon className="text-primary size-5" aria-hidden />
          {title}
        </h2>
        {description && <p className="text-muted-foreground text-sm text-pretty">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** A certificate or licence: its small marked copy (never larger than its frame, not draggable) and its details. */
function DocumentCard({ doc, pdfLabel }: { doc: PublicInstructor["documents"][number]; pdfLabel: string }) {
  return (
    <li className="bg-card flex items-center gap-4 rounded-2xl border p-4">
      <div className="bg-muted ring-foreground/10 relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1 select-none">
        {doc.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host; the small copy only
          <img src={doc.thumbUrl} alt="" loading="lazy" draggable={false} className="pointer-events-none size-full object-cover" />
        ) : (
          <span className="text-primary/70 flex flex-col items-center gap-0.5 text-[0.65rem] font-medium">
            <FileTextIcon className="size-7" aria-hidden />
            {pdfLabel}
          </span>
        )}
      </div>
      <p className="min-w-0 flex-1 leading-snug font-medium">
        <bdi {...langProps(doc.titleLang)}>{doc.title}</bdi>
      </p>
    </li>
  )
}

function WorkshopList({ workshops, locale, done }: { workshops: PublicInstructor["workshops"]; locale: string; done?: string }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {workshops.map((w) => (
        <li key={w.slug}>
          <Link
            href={`/workshops/${w.slug}`}
            className="group bg-card hover:border-primary/40 focus-visible:ring-ring/50 flex items-center gap-4 rounded-2xl border p-3 outline-none transition-colors focus-visible:ring-3"
          >
            <div className="bg-muted size-16 shrink-0 overflow-hidden rounded-xl">
              {w.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
                <img src={w.coverUrl} alt="" loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" />
              ) : (
                <span className="from-primary/15 to-chart-3/20 flex size-full items-center justify-center bg-linear-to-br">
                  <PaletteIcon className="text-primary/50 size-6" aria-hidden />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-primary truncate text-xs font-medium">{w.category}</p>
              <p className="truncate font-medium">{w.title}</p>
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
                {formatWorkshopDates(w, locale, "medium")}
                {done && <span className="bg-muted rounded-full px-2 text-xs">{done}</span>}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const langProps = (lang: string | null) => (lang ? { lang, dir: isRtl(lang) ? "rtl" : "ltr" } : {})

function Paragraphs({ text, lang = null, className }: { text: string; lang?: string | null; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} {...langProps(lang)}>
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p.trim()}
        </p>
      ))}
    </div>
  )
}
