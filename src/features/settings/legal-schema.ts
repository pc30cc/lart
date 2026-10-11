import { z } from "zod"

/** Settings → Legal details: the business behind the site, shown on the legal pages and the Contact page. */
export const legalSettingsSchema = z.object({
  legalName: z.string().trim().max(200),
  taxOffice: z.string().trim().max(100),
  taxNumber: z.string().trim().regex(/^(\d{10,11})?$/, { error: "settings.legal.errors.taxNumber" }),
  mersis: z.string().trim().regex(/^(\d{16})?$/, { error: "settings.legal.errors.mersis" }),
  address: z.string().trim().max(500),
  phone: z.string().trim().max(40),
  email: z.union([z.literal(""), z.email({ error: "settings.legal.errors.email" }).max(254)]),
  kep: z.union([z.literal(""), z.email({ error: "settings.legal.errors.email" }).max(254)]),
})

export type LegalSettingsValues = z.input<typeof legalSettingsSchema>
