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
 * so an email can never point people to another site. The one exception is
 * `paymentUrl` below, for that prop of `registration_received` only.
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

/**
 * The workshop's online payment link (iyzico iyziLink or PayTR "Link ile
 * Ödeme", `courses.payment_url`): the ONLY prop that may point to another
 * site. An https link without a user name or password, nothing else.
 */
const paymentUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((value, ctx) => {
    try {
      const url = new URL(value)
      if (url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".")) return url.href
    } catch {
      // reported below
    }
    ctx.addIssue({ code: "custom", message: "must be an https payment link" })
    return z.NEVER
  })

/** An IBAN as stored ("TR120006…", spaces allowed), shown in groups of four ("TR12 0006 …"); empty stays empty. */
const iban = z
  .string()
  .transform((value) => value.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(/^([A-Z]{2}\d{2}[A-Z0-9]{10,30})?$/))
  .transform((value) => value.replace(/(.{4})(?=.)/g, "$1 "))

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

/**
 * A small titled block under the details (e.g. one way to pay): a title, a
 * few lines, optional label / value rows, lines after the rows, a ready note
 * and a button. `title`, `text`, `after`, row labels and the button label are
 * message keys in emails.json outside the editable texts (e.g.
 * "payment.cash.title"), formatted with the email's values; `note` is ready
 * text (e.g. the admin's note from the settings).
 */
export type EmailSection = {
  title: string
  text: string[]
  rows?: { label: string; value: string; ltr?: boolean }[]
  after?: string[]
  note?: string
  button?: { label: string; href: string }
}

/**
 * The ways to pay that are switched on (settings → payment), shared by
 * `registration_received` and the reminder of an unpaid registration. Pass
 * only the ways that are on and usable (`paymentWays` in ./payment.ts):
 * `cash: true`, `transfer` (the account from the settings, the note in the
 * email's language) and `paymentUrl` (the workshop's own payment link).
 */
const paymentShape = {
  cash: z.literal(true).optional(),
  transfer: z
    .object({
      accountHolder: z.string().trim().max(120),
      bankName: z.string().trim().max(120),
      iban,
      note: z.string().trim().max(500).optional(),
    })
    .optional(),
  paymentUrl: paymentUrl.optional(),
  /** The admin's note about online payment (settings), in the email's language. */
  onlineNote: z.string().trim().max(500).optional(),
}

type PaymentProps = z.output<z.ZodObject<typeof paymentShape>> & { participantName?: string }

/** "none", "one" or "many" ways to pay (the `ways` value of the texts). */
function waysCount(p: PaymentProps): "none" | "one" | "many" {
  const ways = [p.cash, p.transfer, p.paymentUrl].filter(Boolean).length
  return ways === 0 ? "none" : ways === 1 ? "one" : "many"
}

/**
 * One block per way to pay. Their texts use {amount}; the transfer block asks
 * to write {participantName} in the description when the email has it.
 */
function paymentSections(p: PaymentProps): EmailSection[] {
  const out: EmailSection[] = []
  if (p.cash) out.push({ title: "payment.cash.title", text: ["payment.cash.text"] })
  if (p.transfer) {
    const { accountHolder, bankName, iban, note } = p.transfer
    out.push({
      title: "payment.transfer.title",
      text: ["payment.transfer.text"],
      rows: [
        { label: "payment.transfer.holder", value: accountHolder },
        { label: "payment.transfer.bank", value: bankName },
        { label: "payment.transfer.iban", value: iban, ltr: true },
      ].filter((row) => row.value),
      after: p.participantName ? ["payment.transfer.reference"] : [],
      note: note || undefined,
    })
  }
  if (p.paymentUrl) {
    out.push({
      title: "payment.online.title",
      text: ["payment.online.text"],
      note: p.onlineNote || undefined,
      button: { label: "payment.online.button", href: p.paymentUrl },
    })
  }
  return out
}

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
  /** Blocks under the details box. When one has a button, the main button becomes the quieter one. */
  sections?(props: Out<S>): EmailSection[]
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
      /** The workshop's "What to bring", in the email's language. */
      bring: z.string().trim().max(500).optional(),
      workshopUrl: siteUrl.optional(),
      /** Still to pay for the member's unpaid registrations, formatted (`formatLira`); left out when all is paid. */
      amount: text(50).optional(),
      /** Who the unpaid registrations are for ("Ali, Sara"): the bank transfer's description. */
      participantName: text(300).optional(),
      /** The ways to pay, only with `amount` (as in `registration_received`). */
      ...paymentShape,
    }),
    greet: "name",
    cta: "workshopUrl",
    details: { workshop: "workshopTitle", date: "date", time: "time", venue: "venue", bring: "bring", price: "amount" },
    values: (p) => ({ ways: p.amount ? waysCount(p) : "paid" }),
    valueKeys: ["ways"],
    sections: (p) => (p.amount ? paymentSections(p) : []),
  }),
  /**
   * The workshop was cancelled. Everyone registered gets it: with
   * `refundAmount` (what they paid, refunded in full) when they had paid,
   * without it when they had not paid yet (`paid` value: "yes" / "no").
   */
  workshop_cancelled: define({
    schema: z.object({ name: text(), workshopTitle: text(), refundAmount: text(50).optional(), workshopsUrl: siteUrl.optional() }),
    greet: "name",
    cta: "workshopsUrl",
    details: { workshop: "workshopTitle", refund: "refundAmount" },
    values: (p) => ({ paid: p.refundAmount ? "yes" : "no" }),
    valueKeys: ["paid"],
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
  /**
   * Registered, not paid yet: the place is reserved; please pay `amount` in
   * one of the ways the super admin switched on (settings → payment), one
   * block each. Pass only the ways that are on: `cash: true`, `transfer` (the
   * account from the settings, the note in the email's language) and
   * `paymentUrl` (the workshop's own payment link, when online payment is on).
   */
  registration_received: define({
    schema: z.object({
      name: text(),
      /** Who attends (may be the member's child). */
      participantName: text(),
      workshopTitle: text(),
      date: text(100),
      time: text(50),
      /** The venue in the email's language: `localized(course.venue, locale)`. */
      venue: text(300),
      /** The price to pay, formatted (`formatLira`). */
      amount: text(50),
      /** "My workshops": the member's registrations with their payment status. */
      accountUrl: siteUrl,
      ...paymentShape,
    }),
    greet: "name",
    cta: "accountUrl",
    details: {
      workshop: "workshopTitle",
      participant: "participantName",
      date: "date",
      time: "time",
      venue: "venue",
      price: "amount",
    },
    values: (p) => ({ ways: waysCount(p) }),
    valueKeys: ["ways"],
    sections: paymentSections,
  }),
  /**
   * An admin recorded the payment (cash, transfer or online): the
   * registration is paid and the place confirmed. The workshop details are
   * optional. (A registration that needs no payment, a free workshop, gets
   * `registration_confirmed` instead.)
   */
  payment_received: define({
    schema: z.object({
      name: text(),
      workshopTitle: text(),
      /** The amount paid, formatted (`formatLira`). */
      amount: text(50),
      method: z.enum(["cash", "transfer", "online"]),
      date: text(100).optional(),
      time: text(50).optional(),
      /** The venue in the email's language: `localized(course.venue, locale)`. */
      venue: text(300).optional(),
      accountUrl: siteUrl.optional(),
    }),
    greet: "name",
    cta: "accountUrl",
    details: { workshop: "workshopTitle", date: "date", time: "time", venue: "venue", amount: "amount" },
  }),
  /**
   * A registration was cancelled: by the participant ("as you asked") or, with
   * `byUs: true`, by an admin (neutral wording; `by` value: "you" / "us").
   * `refundPercent` (100, 50 or 0, `refundPercent()` in
   * features/registrations/refund-policy) picks the text; leave out
   * `refundAmount` when nothing was paid (then there is no refund line).
   */
  registration_cancelled: define({
    schema: z.object({
      name: text(),
      workshopTitle: text(),
      refundAmount: text(50).optional(),
      refundPercent: z.number().int().min(0).max(100),
      byUs: z.literal(true).optional(),
      workshopsUrl: siteUrl.optional(),
    }),
    greet: "name",
    cta: "workshopsUrl",
    details: { workshop: "workshopTitle", refund: "refundAmount" },
    values: (p) => ({
      refund: !p.refundAmount ? "unpaid" : p.refundPercent >= 100 ? "full" : p.refundPercent > 0 ? "partial" : "none",
      by: p.byUs ? "us" : "you",
    }),
    valueKeys: ["refund", "by"],
  }),
  /** To super admins: a refund is owed and must be paid back by hand (then marked refunded). */
  refund_due: define({
    schema: z.object({ adminName: text(), participantName: text(), workshopTitle: text(), amount: text(50), url: siteUrl }),
    greet: "adminName",
    cta: "url",
    details: { workshop: "workshopTitle", participant: "participantName", refund: "amount" },
  }),
  /** The refund was paid back. */
  refund_sent: define({
    schema: z.object({ name: text(), workshopTitle: text(), amount: text(50), workshopsUrl: siteUrl.optional() }),
    greet: "name",
    cta: "workshopsUrl",
    details: { workshop: "workshopTitle", refund: "amount" },
  }),
} satisfies Record<EmailTemplate, unknown>

/** Props a caller passes for a template (strings arrive pre-formatted; counts are numbers). */
export type EmailProps<T extends EmailTemplate> = z.input<(typeof emailTemplates)[T]["schema"]>

/** Props that cannot be placeholders: objects (e.g. the bank account) and flags. */
const NOT_TEXT = new Set(["object", "literal", "boolean", "array"])

/** The schema type of a prop, without `.optional()`. */
function propType(schema: z.ZodType): string | undefined {
  let def = (schema as unknown as { def?: { type?: string; innerType?: z.ZodType } }).def
  while (def?.type === "optional" && def.innerType) def = (def.innerType as unknown as { def?: typeof def }).def
  return def?.type
}

/**
 * The {placeholders} an email's texts may use: its text and number props, the
 * computed values and `brand`. `numbers` are the ones that are numbers
 * (`{n, number}`, plurals).
 */
export function emailPlaceholders(template: EmailTemplate): { names: string[]; numbers: string[] } {
  const def = emailTemplates[template] as unknown as EmailDefinition
  const shape = def.schema.shape as Record<string, z.ZodType>
  const props = Object.keys(shape).filter((key) => !NOT_TEXT.has(propType(shape[key]) ?? ""))
  const numbers = props.filter((key) => propType(shape[key]) === "number")
  return { names: [...props, ...(def.valueKeys ?? []), "brand"], numbers }
}
