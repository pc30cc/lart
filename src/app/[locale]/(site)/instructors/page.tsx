import { AwardIcon, CalendarDaysIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { listPublicInstructors } from "@/features/instructor-documents/queries"
import { Link } from "@/i18n/navigation"
import { isRtl } from "@/i18n/locales"
import { pageLocale } from "@/i18n/page-locale"
import { getBrand } from "@/lib/settings"

export async function generateMetadata({ params }: PageProps<"/[locale]/instructors">): Promise<Metadata> {
  const locale = pageLocale((await params).locale)
  const [t, brand] = await Promise.all([getTranslations({ locale, namespace: "site.instructorsList" }), getBrand(locale)])
  // Never in search engines, like each instructor's page (not in the sitemap either).
  return { title: t("metaTitle", { brand }), robots: { index: false, follow: true, nocache: true } }
}

/** The instructors (/instructors): each one's photo, name and field, linking to their page. */
export default async function InstructorsPage({ params }: PageProps<"/[locale]/instructors">) {
  const locale = pageLocale((await params).locale)
  const [people, t, brand] = await Promise.all([listPublicInstructors(locale), getTranslations("site.instructorsList"), getBrand(locale)])
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-8 pb-16 sm:pt-12">
      <header className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl rtl:tracking-normal">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose text-base text-pretty">{t("description", { brand })}</p>
      </header>
      {people.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/instructors/${p.slug}`}
                className="group bg-card hover:border-primary/40 focus-visible:ring-ring/50 flex h-full items-center gap-4 rounded-2xl border p-4 outline-none transition-colors focus-visible:ring-3"
              >
                {p.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
                  <img src={p.photoUrl} alt="" loading="lazy" className="bg-muted size-16 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="bg-primary/10 text-primary flex size-16 shrink-0 items-center justify-center rounded-full text-xl font-semibold">
                    {p.name.charAt(0)}
                  </span>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="group-hover:text-primary truncate font-semibold transition-colors">{p.name}</p>
                  {p.field && (
                    <p className="text-muted-foreground truncate text-sm">
                      <bdi {...(p.fieldLang ? { lang: p.fieldLang, dir: isRtl(p.fieldLang) ? "rtl" : "ltr" } : {})}>{p.field}</bdi>
                    </p>
                  )}
                  <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
                    {p.workshops > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDaysIcon className="text-primary size-3.5" aria-hidden />
                        {t("workshops", { count: p.workshops })}
                      </span>
                    )}
                    {p.documents > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <AwardIcon className="text-primary size-3.5" aria-hidden />
                        {t("documents", { count: p.documents })}
                      </span>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
