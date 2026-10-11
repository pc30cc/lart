/**
 * The legal pages' texts (client-safe, no server code): privacy and KVKK, the
 * distance sales agreement with the pre-information form, and the
 * cancellation and refund policy, in fa / tr / en, in the template format
 * (features/contracts/text: "# " title, "## " heading, "- " item, paragraph).
 * The seller's details come from Settings → Legal details (`{seller}`, …).
 * The terms people accept when registering (Templates) say the same.
 */
import { en } from "./texts/en"
import { fa } from "./texts/fa"
import { tr } from "./texts/tr"

export const legalDocs = ["privacy", "distanceSales", "cancellation"] as const
export type LegalDoc = (typeof legalDocs)[number]
export type LegalTexts = Record<LegalDoc, string>

const texts: Record<string, LegalTexts> = { fa, tr, en }

/** The texts' date (written into them as "Last updated"): change it with the texts. */
export const LEGAL_UPDATED = "2026-10-11"

export type LegalValues = {
  brand: string
  /** The legal name, else the brand. */
  seller: string
  taxOffice: string
  taxNumber: string
  mersis: string
  address: string
  phone: string
  email: string
  kep: string
  /** The site's address without the scheme ("limer.tr"). */
  website: string
  /** LEGAL_UPDATED, written in the language. */
  updated: string
}

/**
 * The text of `doc` in `locale`, filled in. A list item whose details are all
 * empty is left out (no "KEP address:" with nothing after it); elsewhere an
 * empty detail reads "—".
 */
export function legalText(doc: LegalDoc, locale: string, values: LegalValues): string {
  const template = (texts[locale] ?? tr)[doc]
  return template
    .split("\n")
    .filter((line) => {
      if (!line.startsWith("- ")) return true
      const names = [...line.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1])
      return names.length === 0 || names.some((name) => (values[name as keyof LegalValues] ?? "").trim() !== "")
    })
    .map((line) =>
      line
        .replace(/\{([a-zA-Z]+)\}/g, (match, name: string) =>
          Object.hasOwn(values, name) ? values[name as keyof LegalValues].trim() || "—" : match,
        )
        // "Tax office and number: {taxOffice} {taxNumber}" with only one of them.
        .replace(/: — (?=\S)/, ": "),
    )
    .join("\n")
}
