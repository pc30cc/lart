import { z } from "zod"

import { uuid } from "@/components/admin/form/schemas"
import type { WorkshopStatus } from "@/features/workshops/schema"
import { instructorEditSchema } from "@/features/instructors/schema"

/**
 * The instructor panel's schemas and small rules (client-safe: the forms use
 * them for instant feedback, the server actions for the real check).
 */

// ─── Signing ──────────────────────────────────────────────────────────────────

/** Zero-width characters, bidi marks and the Arabic tatweel: invisible differences. */
const INVISIBLE = /[​-‏‪-‮⁦-⁩ـ﻿]/g

/**
 * A name as typed, made comparable: Unicode-normalized, invisible characters
 * removed, Arabic yeh / kaf (some Persian keyboards) as the Persian letters,
 * spaces collapsed and trimmed. Also what is stored as the signed name.
 */
export function normalizeName(name: string): string {
  return name.normalize("NFKC").replace(INVISIBLE, "").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ").trim()
}

// Case-insensitive, accents count. Turkish rules (İ/i, I/ı) or the general ones (I/i): either may match.
const collators = [new Intl.Collator("tr", { sensitivity: "accent" }), new Intl.Collator("en", { sensitivity: "accent" })]

/** Whether the typed name is the official name, loosely: spacing and letter case don't matter. */
export function sameName(typed: string, official: string): boolean {
  const a = normalizeName(typed)
  const b = normalizeName(official)
  return a.length > 0 && collators.some((c) => c.compare(a, b) === 0)
}

export const signSchema = z.object({
  contractId: uuid(),
  /** The language of the text on the page: the one that is signed. */
  locale: z.enum(["fa", "tr", "en"]),
  /** SHA-256 of the text on the page, so what is signed is exactly what was read. */
  textSha256: z.string().regex(/^[0-9a-f]{64}$/),
  agree: z.literal(true, { error: "instructorPanel.sign.errors.agree" }),
  signedName: z.string().trim().min(2, { error: "instructorPanel.sign.errors.name" }).max(200),
})
export type SignInput = z.input<typeof signSchema>

// ─── Profile ──────────────────────────────────────────────────────────────────

/** The public profile, as the instructor may edit it (same rules as the admin form). Private fields are not here. */
export const profileSchema = instructorEditSchema.pick({
  displayName: true,
  teachingField: true,
  bio: true,
  teachingLanguages: true,
  website: true,
  photoPath: true,
})
export type ProfileValues = z.input<typeof profileSchema>

// ─── Workshop status in plain words ───────────────────────────────────────────

export type PanelStatus = "toSign" | "open" | "confirmed" | "finished" | "cancelled"

/** What a workshop's status means for the instructor (messages: instructorPanel.status.<status>). */
export function panelStatus(
  w: { status: WorkshopStatus; cancelledAt: Date | null; endsAt: Date },
  now: Date = new Date(),
): PanelStatus {
  if (w.status === "cancelled" || w.cancelledAt !== null) return "cancelled"
  if (w.status === "closed" || (w.status === "confirmed" && w.endsAt <= now)) return "finished"
  if (w.status === "awaiting_signature") return "toSign"
  return w.status === "confirmed" ? "confirmed" : "open"
}
