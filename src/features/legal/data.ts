import "server-only"

import { env } from "@/lib/env"
import { formatDate } from "@/lib/format"
import { getBrand, getSetting } from "@/lib/settings"
import { LEGAL_UPDATED, legalText, type LegalDoc, type LegalValues } from "./texts"

/** What the legal pages fill in, in `locale`: Settings → Legal details, the brand and the site's address. */
export async function getLegalValues(locale: string): Promise<LegalValues> {
  const [brand, legal] = await Promise.all([getBrand(locale), getSetting("legal")])
  return {
    brand,
    seller: legal.legalName || brand,
    taxOffice: legal.taxOffice,
    taxNumber: legal.taxNumber,
    mersis: legal.mersis,
    address: legal.address,
    phone: legal.phone,
    email: legal.email,
    kep: legal.kep,
    website: new URL(env.APP_URL).host,
    updated: formatDate(`${LEGAL_UPDATED}T12:00:00Z`, locale, "long"),
  }
}

/** The legal page `doc` in `locale`, filled in, and its title (its "# " line). */
export async function getLegalPage(doc: LegalDoc, locale: string): Promise<{ title: string; text: string; brand: string }> {
  const values = await getLegalValues(locale)
  const text = legalText(doc, locale, values)
  const title = text.match(/^# (.+)$/m)?.[1].trim() ?? ""
  return { title, text, brand: values.brand }
}
