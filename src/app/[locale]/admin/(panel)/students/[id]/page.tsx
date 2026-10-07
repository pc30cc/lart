import { TicketIcon, UserRoundCheckIcon, UserRoundIcon } from "lucide-react"
import type { Metadata } from "next"
import { hasLocale } from "next-intl"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { AccountAccess } from "@/components/admin/account-access"
import { Detail, Panel } from "@/components/admin/detail-panel"
import { PageHeader } from "@/components/admin/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PaymentCell } from "@/features/registrations/admin/components/payment-cell"
import { getStudent, getStudentRegistrations } from "@/features/students/queries"
import { Link } from "@/i18n/navigation"
import { locales } from "@/i18n/routing"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatDateTime, localized } from "@/lib/format"

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/students/[id]">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const student = await getStudent(id)
  return student ? { title: student.name } : {}
}

export default async function StudentPage({ params }: PageProps<"/[locale]/admin/students/[id]">) {
  await requireAdmin()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const [student, registrations, t, tc, tReg, locale] = await Promise.all([
    getStudent(id),
    getStudentRegistrations(id),
    getTranslations("students"),
    getTranslations("common"),
    getTranslations("workshops.registrations"),
    getLocale(),
  ])
  if (!student) notFound()

  const now = new Date()
  const locked = student.lockedUntil && student.lockedUntil > now ? student.lockedUntil : null

  return (
    <>
      <PageHeader
        title={student.name}
        description={student.email}
        back={{ href: "/admin/students", label: t("backToList") }}
      />

      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <Panel icon={UserRoundIcon} title={t("detail.detailsTitle")} className="min-w-0">
            <dl className="divide-border/70 divide-y">
              <Detail label={t("detail.email")}>
                <a href={`mailto:${student.email}`} className="hover:text-primary break-all transition-colors">
                  <bdi dir="ltr">{student.email}</bdi>
                </a>
              </Detail>
              <Detail label={t("detail.phone")}>
                {student.phone ? (
                  <a
                    href={`tel:${student.phone.replace(/[^+\d]/g, "")}`}
                    className="hover:text-primary tabular-nums transition-colors"
                  >
                    <bdi dir="ltr">{student.phone}</bdi>
                  </a>
                ) : (
                  <span className="text-muted-foreground">{t("detail.noPhone")}</span>
                )}
              </Detail>
              <Detail label={t("detail.language")}>
                {hasLocale(locales, student.locale) ? tc(`locales.${student.locale}`) : student.locale}
              </Detail>
              <Detail label={t("detail.joined")}>{formatDate(student.createdAt, locale, "long")}</Detail>
            </dl>
          </Panel>

          <aside className="min-w-0">
            <Panel icon={UserRoundCheckIcon} title={t("detail.accountTitle")}>
              <dl className="space-y-4 text-sm">
                <div className="space-y-1">
                  <dt className="sr-only">{t("detail.email")}</dt>
                  <dd className={student.emailVerifiedAt ? "text-success" : "text-warning"}>
                    {student.emailVerifiedAt ? t("detail.emailConfirmed") : t("detail.emailNotConfirmed")}
                  </dd>
                </div>
                {locked && (
                  <div className="space-y-1">
                    <dt className="sr-only">{t("detail.accountTitle")}</dt>
                    <dd className="text-warning text-pretty">
                      {t("detail.locked", { time: formatDateTime(locked, locale, "medium") })}
                    </dd>
                  </div>
                )}
                <div className="space-y-1">
                  <dt className="text-muted-foreground">{t("detail.registrations.title")}</dt>
                  <dd className="tabular-nums">{t("detail.registrations.count", { count: student.registrations })}</dd>
                </div>
              </dl>
            </Panel>
          </aside>
        </div>

        <Panel icon={TicketIcon} title={t("detail.registrations.title")} flush>
          {registrations.length === 0 ? (
            <p className="text-muted-foreground px-5 py-8 text-center text-sm md:px-6">{t("detail.registrations.empty")}</p>
          ) : (
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-muted-foreground h-10 px-5 text-start text-xs md:px-6">
                    {t("detail.registrations.workshop")}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden h-10 px-4 text-start text-xs sm:table-cell">
                    {t("detail.registrations.date")}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden h-10 px-4 text-start text-xs md:table-cell">
                    {t("detail.registrations.participant")}
                  </TableHead>
                  <TableHead className="text-muted-foreground h-10 px-5 text-start text-xs md:px-6">
                    {t("detail.registrations.payment")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registrations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="px-5 py-3 whitespace-normal md:px-6">
                      <Link
                        href={`/admin/workshops/${r.course.id}/registrations?q=${encodeURIComponent(r.participantName)}`}
                        className="hover:text-primary font-medium transition-colors"
                      >
                        {localized(r.course.title, locale)}
                      </Link>
                      <span className="text-muted-foreground block text-xs sm:hidden">
                        {formatDate(r.course.startsAt, locale, "medium")}
                      </span>
                      <span className="text-muted-foreground block text-xs md:hidden">
                        <bdi>{r.participantName}</bdi>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden px-4 py-3 whitespace-nowrap tabular-nums sm:table-cell">
                      {formatDate(r.course.startsAt, locale, "medium")}
                    </TableCell>
                    <TableCell className="hidden px-4 py-3 md:table-cell">
                      <bdi>{r.participantName}</bdi>
                    </TableCell>
                    <TableCell className="px-5 py-3 md:px-6">
                      <PaymentCell row={r} t={tReg} locale={locale} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <AccountAccess kind="member" id={student.id} name={student.name} />
      </div>
    </>
  )
}
