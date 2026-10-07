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
 */

const logFailure = (what: string) => (err: unknown) => console.error(`[registrations] ${what} failed`, errorForLog(err))

/**
 * Register for a workshop (a confirmed email is required). On success the
 * "you're registered" page opens, with how to pay; the email follows.
 */
export const registerAction = memberAction(
  registerSchema,
  async (input, ctx) => {
    const { id } = await registerForWorkshop(ctx.member.id, input)
    after(() => sendRegistrationReceived(id).catch(logFailure("registration email")))
    redirect(await localeHref(input.locale, `/account/registrations/${id}?welcome=1`))
  },
  { verified: true },
)

/** Cancel one of the member's own registrations; the refund (if any) follows the terms. */
export const cancelRegistrationAction = memberAction(registrationIdSchema, async ({ id }, ctx) => {
  const cancelled = await cancelMyRegistration(ctx.member.id, id)
  after(() => sendRegistrationCancelled(cancelled).catch(logFailure("cancellation emails")))
  refresh()
  return { paid: cancelled.paid, refund: cancelled.refund, percent: cancelled.percent }
})

/** "My details": name, phone and the language of the member's emails. */
export const saveProfileAction = memberAction(profileSchema, async ({ name, phone, locale }, ctx) => {
  await db
    .update(members)
    .set({ name, phone: phone || null, locale })
    .where(eq(members.id, ctx.member.id))
  refresh()
})
