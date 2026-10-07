import "server-only"
import { eq } from "drizzle-orm"
import { hasLocale } from "next-intl"

import { db } from "@/db"
import { admins, instructors } from "@/db/schema"
import { locales } from "@/i18n/routing"
import { sendEmail } from "@/lib/email"
import { getSetting } from "@/lib/settings"
import { profileText } from "./schema"

/**
 * Emails about an instructor's own sign-up: "waiting for your approval" to
 * every active admin (in the default language: admins have none of their
 * own), and "you're approved" to the instructor, in theirs.
 */

async function findInstructor(id: string) {
  const [row] = await db
    .select({
      email: instructors.email,
      displayName: instructors.displayName,
      teachingField: instructors.teachingField,
      locale: instructors.locale,
      active: instructors.active,
    })
    .from(instructors)
    .where(eq(instructors.id, id))
    .limit(1)
  return row?.active ? row : null
}

/** "New instructor sign-up" to every active admin. Returns how many were sent. */
export async function sendInstructorSignup(id: string): Promise<number> {
  const person = await findInstructor(id)
  if (!person) return 0
  const locale = await getSetting("defaultLocale")
  const team = await db.select({ id: admins.id, name: admins.name, email: admins.email }).from(admins).where(eq(admins.active, true))
  let sent = 0
  for (const admin of team) {
    const result = await sendEmail({
      to: admin.email,
      template: "instructor_signup",
      locale,
      idempotencyKey: `instructor_signup:${id}:${admin.id}`,
      props: {
        adminName: admin.name,
        instructorName: profileText(person.displayName, locale),
        teachingField: profileText(person.teachingField, locale),
        instructorEmail: person.email,
        instructorUrl: `/${locale}/admin/instructors/${id}`,
      },
    })
    if (result.ok) sent++
  }
  return sent
}

/** "You're approved" to the instructor. Returns whether it was sent. */
export async function sendInstructorApproved(id: string): Promise<boolean> {
  const person = await findInstructor(id)
  if (!person) return false
  const locale = hasLocale(locales, person.locale) ? person.locale : "tr"
  const result = await sendEmail({
    to: person.email,
    template: "instructor_approved",
    locale,
    idempotencyKey: `instructor_approved:${id}`,
    props: { name: profileText(person.displayName, locale), panelUrl: `/${locale}/instructor` },
  })
  return result.ok
}
