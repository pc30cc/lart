import {
  CalendarClockIcon,
  CalendarDaysIcon,
  CameraIcon,
  ClockIcon,
  FileSignatureIcon,
  MapPinIcon,
  ShieldCheckIcon,
  SmileIcon,
  UsersRoundIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { Button } from "@/components/ui/button"
import { getMyWorkshop } from "@/features/instructor-panel/queries"
import { panelStatus } from "@/features/instructor-panel/schema"
import { Link } from "@/i18n/navigation"
import { formatDate, formatDateTime, formatNumber, formatTimeRange, localized } from "@/lib/format"
import { cn } from "@/lib/utils"
import { BackLink, card, Section, WorkshopStatus } from "../../_components/parts"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instructorPanel.workshop")
  return { title: t("metaTitle") }
}

/**
 * One of my workshops: the details, and who is coming with their photo /
 * video consent, so I know who may appear in published photos. No contact
 * details or payment status (contract 8.1). Someone else's workshop: not found.
 */
export default async function MyWorkshopPage({ params }: PageProps<"/[locale]/instructor/workshops/[id]">) {
  const { locale, id } = await params
  const workshop = await getMyWorkshop(id)
  if (!workshop) notFound()
  const t = await getTranslations("instructorPanel.workshop")
  const status = panelStatus(workshop)
  const n = (value: number) => formatNumber(value, locale)
  const { participants } = workshop
  const photos = participants.filter((p) => p.photo).length
  const videos = participants.filter((p) => p.video).length

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <BackLink href="/instructor/workshops" label={t("back")} />
        <header className="space-y-3">
          <WorkshopStatus status={status} />
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl rtl:tracking-normal">
            {localized(workshop.title, locale)}
          </h1>
        </header>

        <dl className={cn(card, "grid gap-x-6 gap-y-5 p-5 sm:grid-cols-2 sm:p-6")}>
          <Fact icon={CalendarDaysIcon} label={t("date")}>
            {formatDate(workshop.startsAt, locale, "full")}
          </Fact>
          <Fact icon={ClockIcon} label={t("time")}>
            <bdi>{formatTimeRange(workshop.startsAt, workshop.endsAt, locale)}</bdi>
          </Fact>
          <Fact icon={MapPinIcon} label={t("venue")}>
            {localized(workshop.venue, locale)}
          </Fact>
          <Fact icon={SmileIcon} label={t("age")}>
            {workshop.ageMin !== null || workshop.ageMax !== null
              ? t("children", { min: workshop.ageMin ?? 0, max: workshop.ageMax ?? workshop.ageMin ?? 0 })
              : t("adults")}
          </Fact>
          <Fact icon={UsersRoundIcon} label={t("participants")}>
            {t("places", { count: participants.length, max: workshop.maxCapacity })}
            <span className="text-muted-foreground block text-sm">{t("minimum", { min: workshop.minCapacity })}</span>
          </Fact>
          {status !== "finished" && status !== "cancelled" && (
            <Fact icon={CalendarClockIcon} label={t("decision")}>
              {formatDateTime(workshop.decisionAt, locale, "long")}
              <span className="text-muted-foreground block text-sm">
                {t("deadline", { date: formatDateTime(workshop.registrationDeadline, locale, "long") })}
              </span>
            </Fact>
          )}
        </dl>

        {workshop.contract && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant={workshop.contract.status === "sent" ? "default" : "outline"} className="h-11 rounded-xl px-4">
              <Link href={`/instructor/contracts/${workshop.contract.id}`}>
                <FileSignatureIcon />
                {t(workshop.contract.status === "sent" ? "signContract" : "seeContract")}
              </Link>
            </Button>
          </div>
        )}
      </div>

      <Section title={t("people.title", { count: participants.length })}>
        {participants.length ? (
          <>
            <p className="text-muted-foreground flex gap-2 text-sm text-pretty">
              <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("people.consentHelp")}
            </p>
            <p className="text-sm">
              {t("people.summary", { photos: n(photos), videos: n(videos), total: n(participants.length) })}
            </p>
            <ol className={cn(card, "divide-y")}>
              {participants.map((p, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="text-muted-foreground w-6 shrink-0 text-end text-sm tabular-nums">{n(i + 1)}</span>
                  <span className="min-w-0 flex-1 font-medium break-words">
                    <bdi>{p.name}</bdi>
                  </span>
                  <Consent icon={CameraIcon} yes={p.photo} label={t(p.photo ? "people.photoYes" : "people.photoNo")} />
                  <Consent icon={VideoIcon} yes={p.video} label={t(p.video ? "people.videoYes" : "people.videoNo")} />
                </li>
              ))}
            </ol>
            <p className="text-muted-foreground text-xs text-pretty">{t("people.privacy")}</p>
          </>
        ) : (
          <p className="text-muted-foreground">{t(status === "cancelled" ? "people.cancelled" : "people.none")}</p>
        )}
      </Section>
    </div>
  )
}

function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <dt className="text-muted-foreground text-sm">{label}</dt>
        <dd className="font-medium">{children}</dd>
      </div>
    </div>
  )
}

/** A photo or video consent mark: the icon, crossed out when not given; its meaning in words for screen readers. */
function Consent({ icon: Icon, yes, label }: { icon: LucideIcon; yes: boolean; label: string }) {
  return (
    <span
      title={label}
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-full",
        yes ? "bg-success/12 text-success" : "bg-muted text-muted-foreground/70",
      )}
    >
      <Icon className="size-4.5" aria-hidden />
      {!yes && <span aria-hidden className="absolute h-0.5 w-6 rotate-45 rounded-full bg-current" />}
      <span className="sr-only">{label}</span>
    </span>
  )
}
