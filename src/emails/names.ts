/**
 * The transactional emails and their editable texts. No server code: the
 * templates page (client) uses these lists too. `emailTemplates` in
 * ./templates.ts defines exactly these emails (checked by the type system).
 */

/** Every transactional email, in the order the templates page lists them. */
export const emailTemplateNames = [
  "welcome_verify",
  "instructor_invite",
  "instructor_signup",
  "instructor_approved",
  "contract_ready",
  "contract_signed",
  "decision_due",
  "partner_invite",
  "registration_confirmed",
  "workshop_reminder",
  "workshop_cancelled",
  "password_reset",
  "password_changed_by_team",
  "member_exists",
  "registration_received",
  "payment_received",
  "registration_cancelled",
  "refund_due",
  "refund_sent",
] as const

export type EmailTemplate = (typeof emailTemplateNames)[number]

/**
 * The texts of an email (messages/<locale>/emails.json: emails.<template>.<field>).
 * Admins can replace each of them per language (the `emailTexts` setting).
 */
export const emailTextFields = ["subject", "preview", "heading", "intro", "intro2", "cta", "note"] as const

export type EmailTextField = (typeof emailTextFields)[number]

/** Longest text an admin can write for one field in one language. */
export const EMAIL_TEXT_MAX = 2000
