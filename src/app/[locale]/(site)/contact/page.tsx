import { LandmarkIcon, MailIcon, MapPinIcon, PhoneIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { InstagramGlyph } from "@/components/site/instagram-glyph"
import { LegalShell } from "@/features/legal/components/legal-page"
import { getLegalValues } from "@/features/legal/data"
import { pageLocale } from "@/i18n/page-locale"
import { alternates, openGraphOf } from "@/lib/seo"
import { getSetting } from "@/lib/settings"

/** "Contact · brand", with the language links. */
export async function generateMetadata({ params }: PageProps<"/[locale]/contact">): Promise<Metadata> {
  const locale = pageLocale((await params).locale)
  const [t, values, links] = await Promise.all([
    getTranslations({ locale, namespace: "legal" }),
    getLegalValues(locale),
    alternates("/contact", locale),
  ])
  const description = t("descriptions.contact", { brand: values.brand })
  return {
    title: t("contact.title"),
    description,
    alternates: links,
    openGraph: {
      type: "website",
      title: `${t("contact.title")} · ${values.brand}`,
      description,
      siteName: values.brand,
      ...openGraphOf(locale, links.canonical),
    },
  }
}

/**
 * The Contact page (/contact): the ways to reach the seller and its official
 * details (Settings → Legal details; the Instagram address of Settings → Home
 * page), written out in full as the law and payment providers ask. Only what
 * is set is shown.
 */
export default async function ContactPage({ params }: PageProps<"/[locale]/contact">) {
  const locale = pageLocale((await params).locale)
  const [t, v, home] = await Promise.all([getTranslations({ locale, namespace: "legal.contact" }), getLegalValues(locale), getSetting("home")])
  // Only a web address (never a javascript: or other scheme typed into the setting).
  const instagram = /^https:\/\/[^\s"]+$/i.test(home.footer.instagram) ? home.footer.instagram : ""
  const reach: { icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; label: string; value: string; href?: string; ltr?: boolean }[] = [
    { icon: MapPinIcon, label: t("address"), value: v.address },
    { icon: PhoneIcon, label: t("phone"), value: v.phone, href: `tel:${v.phone.replace(/[^\d+]/g, "")}`, ltr: true },
    { icon: MailIcon, label: t("email"), value: v.email, href: `mailto:${v.email}`, ltr: true },
    { icon: () => <span className="text-primary mt-0.5 size-5 shrink-0 [&_svg]:size-5"><InstagramGlyph /></span>, label: t("instagram"), value: instagram.replace(/^https:\/\/(www\.)?/i, "").replace(/\/$/, ""), href: instagram, ltr: true },
  ].filter((r) => r.value)
  const official = [
    { label: t("legalName"), value: v.seller },
    { label: t("tax"), value: [v.taxOffice, v.taxNumber].filter(Boolean).join(" · ") },
    { label: t("mersis"), value: v.mersis },
    { label: t("kep"), value: v.kep },
  ].filter((r) => r.value)

  return (
    <LegalShell current="/contact">
      <h1 className="text-3xl leading-tight font-semibold text-balance sm:text-4xl">{t("title")}</h1>
      <p className="text-muted-foreground mt-3 max-w-2xl text-pretty">{t("intro")}</p>

      <section aria-labelledby="contact-reach" className="mt-10">
        <h2 id="contact-reach" className="text-xl font-semibold">
          {t("reach")}
        </h2>
        {reach.length === 0 ? (
          <p className="text-muted-foreground mt-4">{t("empty")}</p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {reach.map(({ icon: Icon, label, value, href, ltr }) => (
              <li key={label} className="bg-card ring-foreground/8 flex gap-3.5 rounded-2xl p-4 ring-1">
                <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-muted-foreground text-sm">{label}</p>
                  {href ? (
                    <a
                      href={href}
                      {...(href.startsWith("https:") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="font-medium [overflow-wrap:anywhere] underline-offset-4 hover:underline"
                    >
                      {ltr ? <bdi dir="ltr">{value}</bdi> : value}
                    </a>
                  ) : (
                    <p className="font-medium whitespace-pre-line [overflow-wrap:anywhere]">{value}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="contact-official" className="mt-10">
        <h2 id="contact-official" className="flex items-center gap-2 text-xl font-semibold">
          <LandmarkIcon className="text-primary size-5" aria-hidden />
          {t("company")}
        </h2>
        <dl className="mt-4 divide-y rounded-2xl border">
          {official.map(({ label, value }) => (
            <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
              <dt className="text-muted-foreground text-sm">{label}</dt>
              <dd className="font-medium [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </LegalShell>
  )
}
