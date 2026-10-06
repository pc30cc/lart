import { z } from "zod"

import { localizedText, uuid } from "@/components/admin/form/schemas"
import type { Locale, LocalizedText } from "@/db/schema"
import { EMAIL_TEXT_MAX, emailTemplateNames } from "@/emails/names"
import { templateKinds, unknownPlaceholders, type TemplateKind } from "./placeholders"

/** Longest body per language (the default contract is about 7 000 characters). */
export const TEMPLATE_BODY_MAX = 30_000
export const TEMPLATE_NAME_MAX = 120

const LOCALES: Locale[] = ["fa", "tr", "en"]

const fields = z.object({
  kind: z.enum(templateKinds),
  name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX),
  body: localizedText({ required: LOCALES, max: TEMPLATE_BODY_MAX }),
})

/** Puts an error on each language whose text uses a placeholder the kind does not know. */
function checkPlaceholders(value: { kind: TemplateKind; body: LocalizedText }, ctx: z.RefinementCtx) {
  for (const l of LOCALES) {
    const text = value.body[l]
    if (text && unknownPlaceholders(text, value.kind).length > 0) {
      ctx.addIssue({ code: "custom", path: ["body", l], message: "templates.errors.unknownPlaceholder" })
    }
  }
}

/** Fields of a template, shared by the form (client) and the actions (server). */
export const templateSchema = fields.superRefine(checkPlaceholders)

/** Editing never changes the kind: the server uses the stored kind, not this one. */
export const templateUpdateSchema = fields.extend({ id: uuid() }).superRefine(checkPlaceholders)

export const templateIdSchema = z.object({ id: uuid() })

export type TemplateFormValues = z.input<typeof templateSchema>

// ─── Email texts ──────────────────────────────────────────────────────────────

/** One email text: every language optional (an empty one keeps the default text). */
const emailText = () => localizedText({ max: EMAIL_TEXT_MAX })

/**
 * The admin's texts of one email (the `emailTexts` setting). The action also
 * checks each text's {placeholders} and braces (`checkEmailText`, server).
 */
export const emailTextsSchema = z.object({
  template: z.enum(emailTemplateNames),
  texts: z.object({
    subject: emailText(),
    preview: emailText(),
    heading: emailText(),
    intro: emailText(),
    intro2: emailText(),
    cta: emailText(),
    note: emailText(),
  }),
})

export type EmailTextsValues = z.input<typeof emailTextsSchema>

/** Preview of unsaved texts in one language. */
export const emailPreviewSchema = emailTextsSchema.extend({ locale: z.enum(["fa", "tr", "en"]) })

export const emailTemplateSchema = z.object({ template: z.enum(emailTemplateNames) })
