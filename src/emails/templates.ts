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
