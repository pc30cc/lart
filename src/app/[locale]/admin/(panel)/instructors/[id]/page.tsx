import {
  CalendarRangeIcon,
  ExternalLinkIcon,
  FileSignatureIcon,
  GlobeIcon,
  LockIcon,
  PencilIcon,
  UserRoundCheckIcon,
} from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge, type StatusTone } from "@/components/admin/status-badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getInstructor, getInstructorContracts, getInstructorWorkshops } from "@/features/instructors/queries"
import { languageName, profileText } from "@/features/instructors/schema"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatDateTime, formatTime, localized } from "@/lib/format"
import { IdNumberReveal } from "../_components/id-number-reveal"
import { InstructorAvatar } from "../_components/instructor-avatar"
import { InstructorStatus } from "../_components/instructor-status"
import { InviteButton } from "../_components/invite-button"
import { ManageInstructor } from "../_components/manage-instructor"
import { Detail, LocalizedValue, Panel, VisibilityBadge } from "../_components/profile-parts"

const workshopTones: Record<string, StatusTone> = {
  awaiting_signature: "warning",
  published: "info",
  confirmed: "success",
  cancelled: "danger",
  closed: "neutral",
}
const contractTones: Record<string, StatusTone> = { sent: "warning", signed: "success", void: "neutral" }

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/instructors/[id]">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [instructor, locale] = await Promise.all([getInstructor(id), getLocale()])
  return instructor ? { title: profileText(instructor.displayName, locale) } : {}
}

export default async function InstructorPage({ params }: PageProps<"/[locale]/admin/instructors/[id]">) {
  await requireAdmin()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const [instructor, workshops, contracts, t, locale] = await Promise.all([
    getInstructor(id),
    getInstructorWorkshops(id),
    getInstructorContracts(id),
    getTranslations("instructors"),
    getLocale(),
  ])
  if (!instructor) notFound()

  const name = profileText(instructor.displayName, locale)
  const field = profileText(instructor.teachingField, locale)
  const canInvite = instructor.active && !instructor.hasPassword
  const inviteExpired = instructor.invite ? instructor.invite.expiresAt <= new Date() : false

  return (
    <>
      <PageHeader
        title={name}
        description={field}
        back={{ href: "/admin/instructors", label: t("backToList") }}
        actions={
          <>
            {canInvite && <InviteButton id={instructor.id} again={Boolean(instructor.invite)} />}
            <Button asChild size="lg" className="px-4">
              <Link href={`/admin/instructors/${instructor.id}/edit`}>
                <PencilIcon />
                {t("edit")}
              </Link>
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <div className="min-w-0 space-y-6">
            <Panel
              icon={GlobeIcon}
              title={t("detail.publicTitle")}
              description={t("detail.publicDescription")}
              badge={
                <VisibilityBadge icon={GlobeIcon} tone="public">
                  {t("detail.publicBadge")}
                </VisibilityBadge>
              }
            >
              <div className="mb-6 flex items-center gap-4">
                <InstructorAvatar name={name} url={instructor.photoUrl} className="size-20 text-xl" />
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-lg font-semibold">{name}</p>
                  <p className="text-muted-foreground truncate text-sm">{field}</p>
                </div>
              </div>
              <dl className="divide-border/70 divide-y">
                <Detail label={t("detail.displayName")}>
                  <LocalizedValue text={instructor.displayName} />
                </Detail>
                <Detail label={t("detail.teachingField")}>
                  <LocalizedValue text={instructor.teachingField} />
                </Detail>
                <Detail label={t("detail.bio")}>
                  {instructor.bio ? (
                    <LocalizedValue text={instructor.bio} multiline />
                  ) : (
                    <span className="text-muted-foreground">{t("detail.notSet")}</span>
                  )}
                </Detail>
                <Detail label={t("detail.languages")}>
                  {instructor.teachingLanguages.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {instructor.teachingLanguages.map((code) => (
                        <span key={code} className="bg-muted rounded-full px-2.5 py-0.5 text-xs">
                          {languageName(code, locale)}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t("detail.notSet")}</span>
                  )}
                </Detail>
                <Detail label={t("detail.website")}>
                  {instructor.website ? (
                    <a
                      href={instructor.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-primary inline-flex max-w-full items-center gap-1.5 underline-offset-4 hover:underline"
                    >
                      <bdi className="truncate">{instructor.website.replace(/^https:\/\/(www\.)?/, "")}</bdi>
                      <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{t("detail.notSet")}</span>
                  )}
                </Detail>
              </dl>
            </Panel>

            <Panel
              icon={LockIcon}
              title={t("detail.privateTitle")}
              description={t("detail.privateDescription")}
              badge={
                <VisibilityBadge icon={LockIcon} tone="private">
                  {t("detail.privateBadge")}
                </VisibilityBadge>
              }
            >
              <dl className="divide-border/70 divide-y">
                <Detail label={t("detail.officialName")}>
                  <bdi>{instructor.officialName}</bdi>
                </Detail>
                <Detail label={t("detail.idNumber")}>
                  <IdNumberReveal id={instructor.id} masked={instructor.idNumberMasked} />
                </Detail>
                <Detail label={t("detail.mobile")}>
                  <a href={`tel:${instructor.mobile}`} className="hover:text-primary tabular-nums transition-colors">
                    <bdi dir="ltr">{instructor.mobile}</bdi>
                  </a>
                </Detail>
                <Detail label={t("detail.email")}>
                  <a href={`mailto:${instructor.email}`} className="hover:text-primary break-all transition-colors">
                    <bdi>{instructor.email}</bdi>
                  </a>
                </Detail>
              </dl>
            </Panel>
          </div>

          <aside className="min-w-0 space-y-6">
            <Panel icon={UserRoundCheckIcon} title={t("detail.accountTitle")}>
              <dl className="space-y-4 text-sm">
                <div className="space-y-1.5">
                  <dt className="text-muted-foreground">{t("detail.status")}</dt>
                  <dd>
                    <InstructorStatus active={instructor.active} hasPassword={instructor.hasPassword} />
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-muted-foreground">{t("detail.signIn")}</dt>
                  <dd className="text-pretty">
                    {instructor.hasPassword
                      ? t("detail.signedUp")
                      : instructor.invite && !inviteExpired
                        ? t("detail.inviteSent", {
                            sent: formatDate(instructor.invite.sentAt, locale, "medium"),
                            expires: formatDateTime(instructor.invite.expiresAt, locale, "medium"),
                          })
                        : instructor.invite
                          ? t("detail.inviteExpired", { expires: formatDate(instructor.invite.expiresAt, locale, "medium") })
                          : t("detail.notInvited")}
                  </dd>
                </div>
                {instructor.hasPassword && (
                  <div className="space-y-1">
                    <dt className="sr-only">{t("detail.email")}</dt>
                    <dd className={instructor.emailVerifiedAt ? "text-success" : "text-warning"}>
                      {instructor.emailVerifiedAt ? t("detail.emailVerified") : t("detail.emailNotVerified")}
                    </dd>
                  </div>
                )}
                <div className="space-y-1">
                  <dt className="text-muted-foreground">{t("detail.added")}</dt>
                  <dd>{formatDate(instructor.createdAt, locale, "long")}</dd>
                </div>
              </dl>
            </Panel>
          </aside>
        </div>

        <Panel icon={CalendarRangeIcon} title={t("detail.workshops.title")} flush>
          {workshops.length === 0 ? (
            <p className="text-muted-foreground px-5 py-8 text-center text-sm md:px-6">{t("detail.workshops.empty")}</p>
          ) : (
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-muted-foreground h-10 px-5 text-start text-xs md:px-6">
                    {t("detail.workshops.name")}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden h-10 px-4 text-start text-xs sm:table-cell">
                    {t("detail.workshops.date")}
                  </TableHead>
                  <TableHead className="text-muted-foreground h-10 px-5 text-end text-xs md:px-6">
                    {t("detail.workshops.status")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workshops.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="px-5 py-3 md:px-6">
                      <Link href={`/admin/workshops/${w.id}`} className="hover:text-primary font-medium transition-colors">
                        {localized(w.title, locale)}
                      </Link>
                      <span className="text-muted-foreground block text-xs sm:hidden">
                        {formatDate(w.startsAt, locale, "medium")}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden px-4 py-3 tabular-nums sm:table-cell">
                      {formatDate(w.startsAt, locale, "full")} · {formatTime(w.startsAt, locale)}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-end md:px-6">
                      <StatusBadge tone={workshopTones[w.status]}>{t(`workshopStatus.${w.status}`)}</StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <Panel icon={FileSignatureIcon} title={t("detail.contracts.title")} flush>
          {contracts.length === 0 ? (
            <p className="text-muted-foreground px-5 py-8 text-center text-sm md:px-6">{t("detail.contracts.empty")}</p>
          ) : (
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-muted-foreground h-10 px-5 text-start text-xs md:px-6">
                    {t("detail.contracts.workshop")}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden h-10 px-4 text-start text-xs sm:table-cell">
                    {t("detail.contracts.version")}
                  </TableHead>
                  <TableHead className="text-muted-foreground h-10 px-4 text-start text-xs">
                    {t("detail.contracts.status")}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden h-10 px-5 text-end text-xs md:table-cell md:px-6">
                    {t("detail.contracts.signedAt")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="px-5 py-3 font-medium md:px-6">{localized(c.workshopTitle, locale)}</TableCell>
                    <TableCell className="text-muted-foreground hidden px-4 py-3 tabular-nums sm:table-cell">
                      {t("detail.contracts.versionValue", { version: c.version })}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge tone={contractTones[c.status]}>{t(`contractStatus.${c.status}`)}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden px-5 py-3 text-end tabular-nums md:table-cell md:px-6">
                      {c.signedAt ? formatDate(c.signedAt, locale, "medium") : t("detail.contracts.notSigned")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <ManageInstructor
          id={instructor.id}
          name={name}
          active={instructor.active}
          deletable={instructor.workshops === 0 && instructor.contracts === 0}
        />
      </div>
    </>
  )
}
