"use server"

import { eq } from "drizzle-orm"
import { refresh } from "next/cache"
import { redirect } from "next/navigation"
import { after } from "next/server"

import { db } from "@/db"
import { members } from "@/db/schema"
import { localeHref } from "@/i18n/links"
import { memberAction } from "@/lib/action"
import { errorForLog } from "@/lib/errors"
import { sendRegistrationCancelled, sendRegistrationReceived } from "./notify"
import { cancelMyRegistration, registerForWorkshop } from "./register"
import { profileSchema, registerSchema, registrationIdSchema } from "./schema"

/**
 * The member's registration actions on the site. Every one runs as the
 * signed-in member (`memberAction`) and only ever touches that member's own
 * rows; amounts and seats come from the database, never from the browser.
 * While a super admin views as the member, registering (terms and consents)
 * is refused, and what the admin changes is audited as theirs (`ctx.audit`).
 */

const logFailure = (what: string) => (err: unknown) => console.error(`[registrations] ${what} failed`, errorForLog(err))

/**
 * Register for a workshop (a confirmed email is required). On success the
 * "you're registered" page opens, with how to pay; the email follows. Only the
 * member accepts the terms and consents: refused while a super admin views as them.
 */
export const registerAction = memberAction(
  registerSchema,
  async (input, ctx) => {
    const { id } = await registerForWorkshop(ctx.member.id, input)
    after(() => sendRegistrationReceived(id).catch(logFailure("registration email")))
    redirect(await localeHref(input.locale, `/account/registrations/${id}?welcome=1`))
  },
  { verified: true, notImpersonated: true },
)

/** Cancel one of the member's own registrations; the refund (if any) follows the terms. */
export const cancelRegistrationAction = memberAction(registrationIdSchema, async ({ id }, ctx) => {
  const cancelled = await cancelMyRegistration(ctx.member.id, id)
  const { paid, refund, percent } = cancelled
  // A member's own cancel is not audited; a super admin's (viewing as them) is.
  // Written after cancelMyRegistration's own transaction has committed.
  if (ctx.impersonatedBy) {
    await ctx.audit({ action: "registration.cancel", entity: "registration", entityId: id, data: { paid, refund, percent } })
  }
  after(() => sendRegistrationCancelled(cancelled).catch(logFailure("cancellation emails")))
  refresh()
  return { paid, refund, percent }
})

/** "My details": name, phone and the language of the member's emails. */
export const saveProfileAction = memberAction(profileSchema, async ({ name, phone, locale }, ctx) => {
  const values = { name, phone: phone || null, locale }
  await db.update(members).set(values).where(eq(members.id, ctx.member.id))
  if (ctx.impersonatedBy) {
    // Done by a super admin viewing as the member: audited as theirs (field names only).
    const fields = (["name", "phone", "locale"] as const).filter((k) => ctx.member[k] !== values[k])
    if (fields.length) {
      await ctx.audit({ action: "member.profile_update", entity: "member", entityId: ctx.member.id, data: { fields } })
    }
  }
  refresh()
})
