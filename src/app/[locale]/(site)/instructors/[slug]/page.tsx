import { AwardIcon, CalendarDaysIcon, ChevronLeftIcon, FileTextIcon, LanguagesIcon, PaletteIcon, ShieldCheckIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { PersonPlaceholder } from "@/components/person-placeholder"
import { getPublicInstructor, type PublicInstructor } from "@/features/instructor-documents/queries"
import { languageName } from "@/features/instructors/schema"
import { formatWorkshopDates } from "@/features/workshops/days"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Link } from "@/i18n/navigation"
import { isRtl } from "@/i18n/locales"
import { pageLocale } from "@/i18n/page-locale"
import { formatNumber } from "@/lib/format"
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
  const n = (v: number) => formatNumber(v, locale)

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
            <PersonPlaceholder className="ring-background size-32 ring-4 sm:size-36" />
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
            {person.teachingLanguages.length > 0 && (
              <ul className="flex flex-wrap justify-center gap-2 sm:justify-start">
                <Chip icon={LanguagesIcon}>{person.teachingLanguages.map((c) => languageName(c, locale)).join(t("listSeparator"))}</Chip>
              </ul>
            )}
          </div>
        </div>
        {person.bio && <Paragraphs text={person.bio} lang={person.bioLang} className="text-foreground/85 relative mt-8 border-t pt-6 text-base leading-relaxed" />}
      </header>

      <Tabs defaultValue="workshops" className="mt-10 gap-0">
        <TabsList className="bg-muted/60 ring-foreground/5 grid h-auto! w-full grid-cols-2 gap-1 rounded-2xl p-1.5 ring-1 sm:max-w-md">
          <ProfileTab value="workshops" icon={PaletteIcon} label={t("tabs.workshops")} count={n(person.workshops.length)} />
          <ProfileTab value="documents" icon={AwardIcon} label={t("tabs.documents")} count={n(person.documents.length)} />
        </TabsList>

        <TabsContent value="workshops" className="animate-in fade-in-0 mt-8 space-y-10 duration-300">
          {person.workshops.length === 0 ? (
            <Empty icon={PaletteIcon}>{t("noneHeld")}</Empty>
          ) : (
            <>
              {coming.length > 0 && (
                <Group title={t("coming")} count={n(coming.length)}>
                  <WorkshopGrid workshops={coming} locale={locale} badge={t("comingBadge")} tone="coming" />
                </Group>
              )}
              {held.length > 0 && (
                <Group title={t("held", { brand })} count={n(held.length)}>
                  <WorkshopGrid workshops={held} locale={locale} badge={t("heldBadge")} tone="held" />
                </Group>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="documents" className="animate-in fade-in-0 mt-8 space-y-5 duration-300">
          {person.documents.length === 0 ? (
            <Empty icon={AwardIcon}>{t("documents.none")}</Empty>
          ) : (
            <>
              <p className="text-muted-foreground text-sm text-pretty">{t("documents.description")}</p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {person.documents.map((d) => (
                  <DocumentCard key={d.id} doc={d} pdfLabel={t("documents.pdf")} />
                ))}
              </ul>
              <p className="text-muted-foreground flex items-start gap-2 text-xs text-pretty">
                <ShieldCheckIcon className="mt-px size-3.5 shrink-0" aria-hidden />
                {t("documents.note", { brand })}
              </p>
            </>
          )}
        </TabsContent>
      </Tabs>
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

/** One tab: its icon, name and how many, a raised pill when chosen. */
function ProfileTab({ value, icon: Icon, label, count }: { value: string; icon: typeof AwardIcon; label: string; count: string }) {
  return (
    <TabsTrigger
      value={value}
      className="group/tab data-active:bg-background data-active:text-foreground h-11 gap-2 rounded-xl px-5 text-[0.95rem] data-active:shadow-sm sm:min-w-44"
    >
      <Icon className="group-data-active/tab:text-primary size-4 transition-colors" aria-hidden />
      {label}
      <span className="bg-foreground/[0.06] group-data-active/tab:bg-primary/10 group-data-active/tab:text-primary min-w-6 rounded-full px-1.5 text-xs tabular-nums transition-colors">
        {count}
      </span>
    </TabsTrigger>
  )
}

function Group({ title, count, children }: { title: string; count: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-3 text-lg font-semibold">
        {title}
        <span className="text-muted-foreground text-sm font-normal tabular-nums">{count}</span>
        <span className="bg-border h-px flex-1" aria-hidden />
      </h2>
      {children}
    </section>
  )
}

function Empty({ icon: Icon, children }: { icon: typeof AwardIcon; children: React.ReactNode }) {
  return (
    <div className="bg-card/60 flex flex-col items-center gap-3 rounded-3xl border border-dashed px-6 py-14 text-center">
      <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="text-muted-foreground max-w-sm text-sm text-pretty">{children}</p>
    </div>
  )
}

/** A certificate or licence: its small marked copy (never larger than its frame, not draggable) and its details. */
function DocumentCard({ doc, pdfLabel }: { doc: PublicInstructor["documents"][number]; pdfLabel: string }) {
  return (
    <li className="bg-card flex items-center gap-4 rounded-2xl border p-4">
      <div className="bg-muted ring-foreground/10 relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1 select-none">
        {doc.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host; the small copy only
          <img src={doc.thumbUrl} alt="" draggable={false} className="pointer-events-none size-full object-cover" />
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

/** The workshops as cards: the cover, a badge (coming / held), the craft, the title and the dates. */
function WorkshopGrid({
  workshops,
  locale,
  badge,
  tone,
}: {
  workshops: PublicInstructor["workshops"]
  locale: string
  badge: string
  tone: "coming" | "held"
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {workshops.map((w) => (
        <li key={w.slug}>
          <Link
            href={`/workshops/${w.slug}`}
            className="group bg-card hover:border-primary/40 focus-visible:ring-ring/50 flex h-full flex-col overflow-hidden rounded-2xl border shadow-xs outline-none transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3"
          >
            <div className="bg-muted relative aspect-[16/10] overflow-hidden">
              {w.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
                <img
                  src={w.coverUrl}
                  alt=""
                  loading="lazy"
                  className={cn("size-full object-cover transition-transform duration-500 group-hover:scale-105", tone === "held" && "saturate-[.85]")}
                />
              ) : (
                <span className="from-primary/15 to-chart-3/20 flex size-full items-center justify-center bg-linear-to-br">
                  <PaletteIcon className="text-primary/50 size-10" aria-hidden />
                </span>
              )}
              <span
                className={cn(
                  "absolute start-3 top-3 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur",
                  tone === "coming" ? "bg-primary text-primary-foreground" : "bg-background/85 text-foreground",
                )}
              >
                {badge}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1 p-4">
              <p className="text-primary text-xs font-medium">{w.category}</p>
              <p className="group-hover:text-primary leading-snug font-semibold text-balance transition-colors">{w.title}</p>
              <p className="text-muted-foreground mt-auto flex items-center gap-1.5 pt-2 text-sm">
                <CalendarDaysIcon className="size-3.5 shrink-0" aria-hidden />
                {formatWorkshopDates(w, locale, "medium")}
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
