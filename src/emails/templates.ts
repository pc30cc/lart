import "server-only"
import { z } from "zod"

import { env } from "@/lib/env"
import type { EmailTemplate } from "./names"

export { emailTemplateNames, emailTextFields, type EmailTemplate, type EmailTextField } from "./names"

/**
 * Every transactional email: its props (validated with Zod on the server) and
 * how they fill the shared layout. All copy lives in messages/<locale>/emails.json
 * under the template's name: subject, preview, heading, intro, intro2?, cta, note?.
 * Every prop (and `brand`) can be used as {placeholder} in those messages
 * (`emailPlaceholders`); admins can replace those texts (the `emailTexts` setting).
 */

const text = (max = 200) => z.string().trim().min(1).max(max)
const count = z.number().int().min(0).max(1_000_000)

/**
 * A link on this site: an absolute URL on APP_URL's origin, or a path such as
 * "/tr/verify?token=…" (resolved against APP_URL). Links elsewhere are refused,
 * so an email can never point people to another site.
 */
const siteUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((value, ctx) => {
    const base = new URL(env.APP_URL)
    try {
      const url = new URL(value, base)
      if (url.origin === base.origin) return url.href
    } catch {
      // reported below
    }
    ctx.addIssue({ code: "custom", message: "must be a link on this site (APP_URL)" })
    return z.NEVER
  })

/** Labels of the details box (messages: emails.details.<label>). */
export type DetailLabel =
  | "workshop"
  | "instructor"
  | "date"
  | "time"
  | "venue"
  | "amount"
  | "bring"
  | "registrations"
  | "minimum"
  | "decisionAt"
  | "refund"
  | "price"
  | "participant"

type Out<S extends z.ZodObject> = z.output<S>
type Key<S extends z.ZodObject> = Extract<keyof Out<S>, string>

export type EmailDefinition<S extends z.ZodObject = z.ZodObject> = {
  schema: S
  /** Prop with the recipient's name, used in the greeting. */
  greet: Key<S>
  /** Prop with the button link. When it is optional and missing, the button opens the site's home page. */
  cta: Key<S>
  /** Rows of the details box, in order (label → prop). Empty optional props are skipped. */
  details?: Partial<Record<DetailLabel, Key<S>>>
  /** Prop with a link for the note: the note text becomes that link (a second, quieter way on). */
  noteLink?: Key<S>
  /** Extra message values computed from the props; `valueKeys` lists their names (placeholders). */
  values?(props: Out<S>): Record<string, string | number>
  valueKeys?: readonly string[]
}

const define = <S extends z.ZodObject>(definition: EmailDefinition<S>) => definition

export const emailTemplates = {
  welcome_verify: define({
    schema: z.object({ name: text(), verifyUrl: siteUrl }),
    greet: "name",
    cta: "verifyUrl",
  }),
  instructor_invite: define({
    schema: z.object({ name: text(), acceptUrl: siteUrl }),
    greet: "name",
    cta: "acceptUrl",
  }),
  contract_ready: define({
    schema: z.object({ instructorName: text(), workshopTitle: text(), workshopDate: text(100), signUrl: siteUrl }),
    greet: "instructorName",
    cta: "signUrl",
    details: { workshop: "workshopTitle", date: "workshopDate" },
  }),
  contract_signed: define({
    schema: z.object({ adminName: text(), instructorName: text(), workshopTitle: text(), workshopUrl: siteUrl }),
    greet: "adminName",
    cta: "workshopUrl",
    details: { workshop: "workshopTitle", instructor: "instructorName" },
  }),
  decision_due: define({
    schema: z.object({
      adminName: text(),
      workshopTitle: text(),
      registrations: count,
      minimum: count,
      decisionAt: text(100),
      workshopUrl: siteUrl,
    }),
    greet: "adminName",
    cta: "workshopUrl",
    details: { workshop: "workshopTitle", registrations: "registrations", minimum: "minimum", decisionAt: "decisionAt" },
    values: (p) => ({ status: p.registrations >= p.minimum ? "reached" : "notReached" }),
    valueKeys: ["status"],
  }),
  registration_confirmed: define({
    schema: z.object({
      name: text(),
      workshopTitle: text(),
      date: text(100),
      time: text(50),
      /** The venue in the email's language: `localized(course.venue, locale)`. */
      venue: text(300),
      amount: text(50),
      workshopUrl: siteUrl.optional(),
    }),
    greet: "name",
    cta: "workshopUrl",
    details: { workshop: "workshopTitle", date: "date", time: "time", venue: "venue", amount: "amount" },
  }),
  workshop_reminder: define({
    schema: z.object({
      name: text(),
      workshopTitle: text(),
      date: text(100),
      time: text(50),
      /** The venue in the email's language: `localized(course.venue, locale)`. */
      venue: text(300),
      bring: z.string().trim().max(500).optional(),
      workshopUrl: siteUrl.optional(),
    }),
    greet: "name",
    cta: "workshopUrl",
    details: { workshop: "workshopTitle", date: "date", time: "time", venue: "venue", bring: "bring" },
  }),
  workshop_cancelled: define({
    schema: z.object({ name: text(), workshopTitle: text(), refundAmount: text(50), workshopsUrl: siteUrl.optional() }),
    greet: "name",
    cta: "workshopsUrl",
    details: { workshop: "workshopTitle", refund: "refundAmount" },
  }),
  password_reset: define({
    schema: z.object({ name: text(), resetUrl: siteUrl }),
    greet: "name",
    cta: "resetUrl",
  }),
  /** Someone signed up with the email of an existing member: log in, or choose a new password (the note links to "forgot"). */
  member_exists: define({
    schema: z.object({ name: text(), loginUrl: siteUrl, resetUrl: siteUrl }),
    greet: "name",
    cta: "loginUrl",
    noteLink: "resetUrl",
  }),
  /** Registered while online payment is off: the place is saved, the team sends payment instructions. */
  registration_pending: define({
    schema: z.object({
      name: text(),
      workshopTitle: text(),
      date: text(100),
      time: text(50),
      /** The venue in the email's language: `localized(course.venue, locale)`. */
      venue: text(300),
      /** The price to pay, formatted (`formatLira`). */
      amount: text(50),
      accountUrl: siteUrl,
    }),
    greet: "name",
    cta: "accountUrl",
    details: { workshop: "workshopTitle", date: "date", time: "time", venue: "venue", price: "amount" },
  }),
  /** The participant cancelled; `refundPercent` (100, 50 or 0) picks the text. */
  registration_cancelled: define({
    schema: z.object({
      name: text(),
      workshopTitle: text(),
      refundAmount: text(50),
      refundPercent: z.number().int().min(0).max(100),
      workshopsUrl: siteUrl.optional(),
    }),
    greet: "name",
    cta: "workshopsUrl",
    details: { workshop: "workshopTitle", refund: "refundAmount" },
    values: (p) => ({ refund: p.refundPercent >= 100 ? "full" : p.refundPercent > 0 ? "partial" : "none" }),
    valueKeys: ["refund"],
  }),
  /** The refund was paid back. */
  refund_sent: define({
    schema: z.object({ name: text(), workshopTitle: text(), amount: text(50), workshopsUrl: siteUrl.optional() }),
    greet: "name",
    cta: "workshopsUrl",
    details: { workshop: "workshopTitle", refund: "amount" },
  }),
  /** To super admins: a refund is owed and needs paying. */
  refund_due: define({
    schema: z.object({ adminName: text(), participantName: text(), workshopTitle: text(), amount: text(50), url: siteUrl }),
    greet: "adminName",
    cta: "url",
    details: { workshop: "workshopTitle", participant: "participantName", refund: "amount" },
  }),
  /** To super admins: money was taken but the seat could not be given (refund needed). */
  payment_problem: define({
    schema: z.object({ adminName: text(), participantName: text(), workshopTitle: text(), amount: text(50), url: siteUrl }),
    greet: "adminName",
    cta: "url",
    details: { workshop: "workshopTitle", participant: "participantName", amount: "amount" },
  }),
} satisfies Record<EmailTemplate, unknown>

/** Props a caller passes for a template (strings arrive pre-formatted; counts are numbers). */
export type EmailProps<T extends EmailTemplate> = z.input<(typeof emailTemplates)[T]["schema"]>

/**
 * The {placeholders} an email's texts may use: its props, the computed values
 * and `brand`. `numbers` are the ones that are numbers (`{n, number}`, plurals).
 */
export function emailPlaceholders(template: EmailTemplate): { names: string[]; numbers: string[] } {
  const def = emailTemplates[template] as unknown as EmailDefinition
  const shape = def.schema.shape as Record<string, z.ZodType>
  const props = Object.keys(shape)
  const numbers = props.filter((key) => {
    const type = (shape[key] as { def?: { type?: string; innerType?: { def?: { type?: string } } } }).def
    return type?.type === "number" || type?.innerType?.def?.type === "number"
  })
  return { names: [...props, ...(def.valueKeys ?? []), "brand"], numbers }
}
