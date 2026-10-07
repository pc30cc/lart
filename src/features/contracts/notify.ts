import "server-only"
import { and, eq } from "drizzle-orm"
import { hasLocale } from "next-intl"

import { db } from "@/db"
import { admins, contracts, courses, instructors } from "@/db/schema"
import { locales } from "@/i18n/routing"
import { sendEmail } from "@/lib/email"
import { formatDate, formatTimeRange, localized } from "@/lib/format"
import { getSetting } from "@/lib/settings"

/**
 * Contract emails. The instructor's go out in the instructor's own language
 * (`instructors.locale`: until the instructor accepts the invitation, the
 * invitation language the admin chose when creating the instructor or
 * resending the invitation; then the invitation page's language, or the one
 * chosen in the panel), with the sign link in that language too. Admins have
 * no language of their own, so theirs use the default-language setting.
 */

/** Where the instructor reads and signs a contract (instructor panel, phase 2). */
export const signPath = (locale: string, contractId: string) => `/${locale}/instructor/contracts/${contractId}`
export const workshopAdminPath = (locale: string, courseId: string) => `/${locale}/admin/workshops/${courseId}`

/** "Contract ready to sign" to the instructor. Returns whether it was sent. */
export async function sendContractReady(contractId: string): Promise<boolean> {
  const [row] = await db
    .select({
      email: instructors.email,
      officialName: instructors.officialName,
      displayName: instructors.displayName,
      locale: instructors.locale,
      title: courses.title,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
    })
    .from(contracts)
    .innerJoin(courses, eq(courses.id, contracts.courseId))
    .innerJoin(instructors, eq(instructors.id, contracts.instructorId))
    .where(and(eq(contracts.id, contractId), eq(contracts.status, "sent")))
    .limit(1)
  if (!row) return false
  const locale = hasLocale(locales, row.locale) ? row.locale : await getSetting("defaultLocale")
  const result = await sendEmail({
    to: row.email,
    template: "contract_ready",
    locale,
    props: {
      instructorName: localized(row.displayName, locale) || row.officialName,
      workshopTitle: localized(row.title, locale),
      // Persian uses its own comma.
      workshopDate: `${formatDate(row.startsAt, locale, "full")}${locale === "fa" ? "،" : ","} ${formatTimeRange(row.startsAt, row.endsAt, locale)}`,
      signUrl: signPath(locale, contractId),
    },
  })
  return result.ok
}

/** "Contract signed" to every active super admin. Returns how many were sent. */
export async function sendContractSigned(contractId: string): Promise<number> {
  const [row] = await db
    .select({
      courseId: contracts.courseId,
      officialName: instructors.officialName,
      displayName: instructors.displayName,
      title: courses.title,
    })
    .from(contracts)
    .innerJoin(courses, eq(courses.id, contracts.courseId))
    .innerJoin(instructors, eq(instructors.id, contracts.instructorId))
    .where(eq(contracts.id, contractId))
    .limit(1)
  if (!row) return 0
  const locale = await getSetting("defaultLocale")
  const team = await db.select({ id: admins.id, name: admins.name, email: admins.email }).from(admins).where(eq(admins.active, true))
  let sent = 0
  for (const admin of team) {
    const result = await sendEmail({
      to: admin.email,
      template: "contract_signed",
      locale,
      idempotencyKey: `contract_signed:${contractId}:${admin.id}`,
      props: {
        adminName: admin.name,
        instructorName: localized(row.displayName, locale) || row.officialName,
        workshopTitle: localized(row.title, locale),
        workshopUrl: workshopAdminPath(locale, row.courseId),
      },
    })
    if (result.ok) sent++
  }
  return sent
}
