/**
 * Template kinds and their `{placeholders}` (client-safe, no server code).
 * A placeholder is `{name}` with lower-case letters and underscores; it is
 * filled in when the text is shown (terms) or rendered and signed (contracts).
 */
import { contractPlaceholders } from "@/features/contracts/text"

export const templateKinds = ["terms", "contract"] as const
export type TemplateKind = (typeof templateKinds)[number]

/** The placeholders each kind may use. */
export const templatePlaceholders: Record<TemplateKind, readonly string[]> = {
  terms: ["brand"],
  contract: contractPlaceholders,
}

const PLACEHOLDER = /\{([a-z_]+)\}/g

/** The distinct placeholder names used in a text, in order of appearance. */
export function placeholdersIn(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (m) => m[1]))]
}

/** Placeholders in `text` that `kind` does not know (usually a typo). */
export function unknownPlaceholders(text: string, kind: TemplateKind): string[] {
  const known = templatePlaceholders[kind]
  return placeholdersIn(text).filter((name) => !known.includes(name))
}

/** Replace each known `{name}` with its value; anything else is left as it is. */
export function fillTemplate(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (match, name: string) => (Object.hasOwn(values, name) ? values[name] : match))
}
