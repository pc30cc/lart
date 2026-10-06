import {
  BanIcon,
  CalendarCheck2Icon,
  CheckIcon,
  FileSignatureIcon,
  ImageIcon,
  ImagesIcon,
  MailIcon,
  PartyPopperIcon,
  PencilIcon,
  PhoneIcon,
  ReceiptTextIcon,
  TimerIcon,
  type LucideIcon,
} from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { Money } from "@/components/admin/money"
import { Button } from "@/components/ui/button"
import type { LocalizedText } from "@/db/schema"
import { getWorkshop, type Workshop } from "@/features/workshops/queries"
import { displayStatus, isCancelled } from "@/features/workshops/schema"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatDateTime, formatNumber, formatTimeRange, localized } from "@/lib/format"
import { cn } from "@/lib/utils"
import { CancelWorkshopButton, ConfirmWorkshopButton, ResendContractButton } from "../_components/lifecycle-actions"
import { WorkshopHeader } from "../_components/workshop-header"
import { FillMeter } from "../_components/workshop-status"

async function load(id: string) {
  if (!z.uuid().safeParse(id).success) notFound()
  const workshop = await getWorkshop(id)
  if (!workshop) notFound()
  return workshop
}

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/workshops/[id]">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [workshop, locale] = await Promise.all([getWorkshop(id), getLocale()])
  return workshop ? { title: localized(workshop.title, locale) } : {}
}

export default async function WorkshopPage({ params }: PageProps<"/[locale]/admin/workshops/[id]">) {
  await requireAdmin()
  const { id } = await params
  const [w, t, locale] = await Promise.all([load(id), getTranslations("workshops"), getLocale()])
  const n = (v: number) => formatNumber(v, locale)

  return (
    <>
      <WorkshopHeader
        workshop={w}
        active="overview"
        actions={
          <Button asChild variant="outline" size="lg" className="px-4">
            <Link href={`/admin/workshops/${w.id}/edit`}>
              <PencilIcon />
              {t("overview.edit")}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <NextStep workshop={w} />

          <Card title={t("overview.details")}>
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <Fact label={t("overview.when")}>
                {formatDate(w.startsAt, locale, "full")}
                <Sub>
                  <bdi className="tabular-nums">{formatTimeRange(w.startsAt, w.endsAt, locale)}</bdi>
                </Sub>
              </Fact>
              <Fact label={t("fields.venue")}>{w.venue}</Fact>
              <Fact label={t("fields.registrationDeadline")}>{formatDateTime(w.registrationDeadline, locale, "long")}</Fact>
              <Fact label={t("fields.decisionAt")}>
                {formatDateTime(w.decisionAt, locale, "long")}
                {w.decisionNotifiedAt && (
                  <Sub>{t("overview.decisionNotified", { date: formatDateTime(w.decisionNotifiedAt, locale, "medium") })}</Sub>
                )}
              </Fact>
              <Fact label={t("fields.category")}>{localized(w.category.name, locale)}</Fact>
              <Fact label={t("fields.ageGroup")}>
                {w.ageMin !== null || w.ageMax !== null
                  ? t("overview.childrenRange", { min: n(w.ageMin ?? 0), max: n(w.ageMax ?? 0) })
                  : t("fields.adults")}
              </Fact>
              <Fact label={t("overview.capacity")}>
                {t("overview.capacityRange", { min: n(w.minCapacity), max: n(w.maxCapacity) })}
              </Fact>
              <Fact label={t("fields.price")}>
                <Money value={w.price} />
              </Fact>
              <Fact label={t("fields.terms")}>{w.termsTemplateName ?? t("fields.termsDefault")}</Fact>
              <Fact label={t("fields.slug")}>
                <code dir="ltr" className="bg-muted rounded-md px-1.5 py-0.5 font-mono text-xs">
                  {w.slug}
                </code>
              </Fact>
            </dl>
          </Card>

          <Card title={t("overview.about")}>
            <div className="space-y-5">
              <TextBlock label={t("fields.intro")} text={w.intro} locale={locale} empty={t("overview.notWritten")} />
              <TextBlock label={t("fields.includes")} text={w.includes} locale={locale} empty={t("overview.notWritten")} />
              <TextBlock
                label={t("fields.bring")}
                text={w.bring}
                locale={locale}
                empty={t("fields.bringNothing")}
              />
              <TextBlock
                label={t("fields.experience")}
                text={w.experienceNote}
                locale={locale}
                empty={w.experienceRequired ? t("overview.experienceYes") : t("overview.experienceNo")}
                prefix={w.experienceRequired && w.experienceNote ? t("overview.experienceYes") : undefined}
              />
              {w.notes && <TextBlock label={t("fields.notes")} text={w.notes} locale={locale} empty="" />}
            </div>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card title={t("overview.participants")}>
            <FillMeter
              size="lg"
              confirmed={w.registered.confirmed}
              min={w.minCapacity}
              max={w.maxCapacity}
              label={t("table.fillValue", { confirmed: n(w.registered.confirmed), max: n(w.maxCapacity) })}
            />
            <ul className="text-muted-foreground mt-4 space-y-1.5 text-sm">
              <li>{t("overview.minimum", { count: w.minCapacity })}</li>
              {w.registered.pending > 0 && <li>{t("overview.pending", { count: w.registered.pending })}</li>}
              {w.finalParticipants !== null && (
                <li className="text-foreground font-medium">{t("overview.final", { count: w.finalParticipants })}</li>
              )}
            </ul>
            <Button asChild variant="link" className="mt-2 h-auto px-0">
              <Link href={`/admin/workshops/${w.id}/registrations`}>{t("overview.seeRegistrations")}</Link>
            </Button>
          </Card>

          <Card title={t("overview.contract")}>
            {w.contract ? (
              <div className="space-y-3 text-sm">
                <p className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t("overview.contractVersion", { version: n(w.contract.version) })}</span>
                  <span className="font-medium">{t(`contractStatus.${w.contract.status}`)}</span>
                </p>
                <p className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t(`fields.feeTypes.${w.contract.feeType}`)}</span>
                  <Money value={w.contract.feeAmount} className="font-medium" />
                </p>
                <p className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t("fields.advanceAmount")}</span>
                  {w.contract.advanceAmount > 0 ? <Money value={w.contract.advanceAmount} /> : <span>{t("overview.noAdvance")}</span>}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">{t("overview.noContract")}</p>
            )}
            <Button asChild variant="link" className="mt-2 h-auto px-0">
              <Link href={`/admin/workshops/${w.id}/contract`}>{t("overview.openContract")}</Link>
            </Button>
          </Card>

          <Card title={t("overview.instructor")}>
            <p className="font-medium">{localized(w.instructor.displayName, locale)}</p>
            <p className="text-muted-foreground text-sm">{w.instructor.officialName}</p>
            <div className="mt-3 space-y-1.5 text-sm">
              <a href={`mailto:${w.instructor.email}`} className="hover:text-primary flex items-center gap-2 break-all">
                <MailIcon className="text-muted-foreground size-4 shrink-0" />
                <bdi>{w.instructor.email}</bdi>
              </a>
              <a href={`tel:${w.instructor.mobile.replace(/[^+\d]/g, "")}`} className="hover:text-primary flex items-center gap-2">
                <PhoneIcon className="text-muted-foreground size-4 shrink-0" />
                <bdi dir="ltr">{w.instructor.mobile}</bdi>
              </a>
            </div>
            <p className="text-muted-foreground mt-3 text-xs">{t("overview.privateHint")}</p>
          </Card>

          <Card title={t("overview.photos")}>
            {w.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- CDN URL decided at runtime
              <img src={w.coverUrl} alt="" className="ring-foreground/8 aspect-video w-full rounded-lg object-cover ring-1" />
            ) : (
              <div className="bg-muted text-muted-foreground flex aspect-video flex-col items-center justify-center gap-1.5 rounded-lg text-xs">
                <ImageIcon className="size-5" />
                {t("overview.noCover")}
              </div>
            )}
            {w.samples.length > 0 && (
              <div className="mt-2 grid grid-cols-4 gap-2">
                {w.samples.slice(0, 8).map((s) =>
                  s.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- CDN URL decided at runtime
                    <img key={s.path} src={s.url} alt="" loading="lazy" className="aspect-square w-full rounded-md object-cover" />
                  ) : null,
                )}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  )
}

// ─── Next step ────────────────────────────────────────────────────────────────

async function NextStep({ workshop: w }: { workshop: Workshop }) {
  const [t, locale] = await Promise.all([getTranslations("workshops"), getLocale()])
  const now = new Date()
  const title = localized(w.title, locale)
  const open = w.registered.pending + w.registered.confirmed
  const name = localized(w.instructor.displayName, locale)
  const n = (v: number) => formatNumber(v, locale)
  const cancel = <CancelWorkshopButton id={w.id} title={title} registrations={open} variant="ghost" />

  let step: { icon: LucideIcon; tone: Tone; title: string; text: string; actions?: React.ReactNode }
  // A cancelled workshop stays cancelled after its books are closed (no gallery).
  switch (displayStatus(w)) {
    case "awaiting_signature":
      step = {
        icon: FileSignatureIcon,
        tone: "warning",
        title: t("next.awaiting.title", { name }),
        text: w.contract
          ? t("next.awaiting.text", { version: n(w.contract.version), date: formatDate(w.contract.sentAt, locale, "long") })
          : t("next.awaiting.noContract"),
        actions: (
          <>
            {w.contract?.status === "sent" && <ResendContractButton courseId={w.id} />}
            <Button asChild variant="ghost" size="lg" className="px-4">
              <Link href={`/admin/workshops/${w.id}/contract`}>{t("next.viewContract")}</Link>
            </Button>
            {cancel}
          </>
        ),
      }
      break
    case "published": {
      const due = w.decisionAt <= now
      step = {
        icon: due ? TimerIcon : CalendarCheck2Icon,
        tone: due ? "warning" : "info",
        title: due ? t("next.published.dueTitle") : t("next.published.title"),
        text: t("next.published.text", {
          deadline: formatDateTime(w.registrationDeadline, locale, "long"),
          decision: formatDateTime(w.decisionAt, locale, "long"),
          confirmed: w.registered.confirmed,
          minimum: n(w.minCapacity),
        }),
        actions: (
          <>
            <ConfirmWorkshopButton id={w.id} title={title} confirmed={w.registered.confirmed} minimum={w.minCapacity} />
            <CancelWorkshopButton id={w.id} title={title} registrations={open} />
          </>
        ),
      }
      break
    }
    case "confirmed":
      step =
        w.endsAt <= now
          ? {
              icon: ReceiptTextIcon,
              tone: "brand",
              title: t("next.held.title"),
              text: t("next.held.text"),
              actions: (
                <Button asChild size="lg" className="px-4">
                  <Link href={`/admin/workshops/${w.id}/finances`}>{t("next.held.action")}</Link>
                </Button>
              ),
            }
          : {
              icon: PartyPopperIcon,
              tone: "success",
              title: t("next.confirmed.title"),
              text: t("next.confirmed.text", {
                count: w.finalParticipants ?? w.registered.confirmed,
                date: formatDate(w.startsAt, locale, "full"),
              }),
              actions: cancel,
            }
      break
    case "cancelled":
      step = {
        icon: BanIcon,
        tone: "danger",
        title: t("next.cancelled.title"),
        text: t("next.cancelled.text", {
          date: formatDate(w.cancelledAt ?? w.updatedAt, locale, "long"),
          count: w.registered.cancelled,
        }),
      }
      break
    case "closed":
      step = {
        icon: ImagesIcon,
        tone: "neutral",
        title: w.galleryCount ? t("next.closed.titleDone") : t("next.closed.title"),
        text: w.galleryCount ? t("next.closed.textDone", { count: w.galleryCount }) : t("next.closed.text"),
        actions: (
          <Button asChild size="lg" variant={w.galleryCount ? "outline" : "default"} className="px-4">
            <Link href={`/admin/workshops/${w.id}/gallery`}>{t("next.closed.action")}</Link>
          </Button>
        ),
      }
      break
  }

  return (
    <section className="bg-card ring-foreground/8 overflow-hidden rounded-xl shadow-xs ring-1">
      <Timeline workshop={w} />
      <div className="flex flex-col gap-5 p-5 md:p-6">
        <div className="flex gap-4">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", toneClass[step.tone])}>
            <step.icon className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-balance">{step.title}</h2>
            <p className="text-muted-foreground text-sm text-pretty">{step.text}</p>
          </div>
        </div>
        {step.actions && <div className="flex flex-wrap items-center gap-2 sm:ps-15">{step.actions}</div>}
      </div>
    </section>
  )
}

type Tone = "warning" | "info" | "success" | "danger" | "neutral" | "brand"
const toneClass: Record<Tone, string> = {
  warning: "bg-warning/12 text-warning",
  info: "bg-info/12 text-info",
  success: "bg-success/12 text-success",
  danger: "bg-destructive/12 text-destructive",
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-primary/12 text-primary",
}

/** The lifecycle as a row of steps: done, current, still to come. */
async function Timeline({ workshop: w }: { workshop: Workshop }) {
  const [t, locale] = await Promise.all([getTranslations("workshops.timeline"), getLocale()])
  const now = new Date()
  const s = w.status
  // Cancelled, also after its books were closed: nothing after the signature happened.
  const cancelled = isCancelled(w)
  const going = !cancelled && (s === "confirmed" || s === "closed")
  const done = [
    true, // created + contract sent
    cancelled ? w.publishedAt !== null : s === "published" || s === "confirmed" || s === "closed",
    // A contract re-issued after the go decision waits for the signature, but the decision stands.
    going || (!cancelled && w.finalParticipants !== null),
    going && w.endsAt <= now,
    !cancelled && s === "closed",
    !cancelled && s === "closed" && w.galleryCount > 0,
  ]
  const labels = [t("sent"), t("signed"), t("decision"), t("held"), t("closed"), t("gallery")]
  const current = cancelled ? -1 : done.indexOf(false)

  return (
    // `relative`: the sr-only labels (position: absolute) are clipped by this scroller, not the page.
    <ol className="bg-muted/35 relative flex overflow-x-auto border-b px-3 py-3 md:px-5" aria-label={t("label")}>
      {labels.map((label, i) => {
        const isDone = done[i]
        const isCurrent = i === current
        return (
          <li key={label} className="flex min-w-max flex-1 items-center gap-2 pe-3 last:pe-0">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold tabular-nums",
                isDone
                  ? "bg-success text-background"
                  : isCurrent
                    ? "bg-primary text-primary-foreground ring-primary/20 ring-4"
                    : "bg-foreground/8 text-muted-foreground",
              )}
            >
              {isDone ? <CheckIcon className="size-3 stroke-3" /> : formatNumber(i + 1, locale)}
            </span>
            <span
              className={cn("text-xs whitespace-nowrap", isCurrent ? "text-foreground font-medium" : "text-muted-foreground")}
              aria-current={isCurrent ? "step" : undefined}
            >
              {label}
              <span className="sr-only"> ({isDone ? t("done") : isCurrent ? t("current") : t("todo")})</span>
            </span>
            {i < labels.length - 1 && <span aria-hidden className="bg-border ms-1 hidden h-px min-w-4 flex-1 sm:block" />}
          </li>
        )
      })}
      {cancelled && (
        <li className="text-destructive ms-2 flex min-w-max items-center gap-1.5 text-xs font-medium">
          <BanIcon className="size-3.5" />
          {t("cancelled")}
        </li>
      )}
    </ol>
  )
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card ring-foreground/8 rounded-xl p-5 shadow-xs ring-1 md:p-6">
      <h2 className="text-muted-foreground mb-4 text-xs font-medium tracking-wide uppercase rtl:tracking-normal">{title}</h2>
      {children}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  )
}

function Sub({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground block text-xs">{children}</span>
}

function TextBlock({
  label,
  text,
  locale,
  empty,
  prefix,
}: {
  label: string
  text: LocalizedText | null
  locale: string
  empty: string
  prefix?: string
}) {
  const value = localized(text, locale)
  return (
    <div className="space-y-1">
      <h3 className="text-muted-foreground text-xs">{label}</h3>
      {value ? (
        <p className="text-sm leading-relaxed whitespace-pre-line">
          {prefix && <span className="font-medium">{prefix} · </span>}
          {value}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">{empty}</p>
      )}
    </div>
  )
}
