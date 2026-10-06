import "server-only"
import { asc, eq, sql } from "drizzle-orm"

import { db } from "@/db"
import { contracts, type Locale } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { renderContract } from "./render"

/** Every version of a workshop's contract, oldest first (metadata only). */
export async function listContractVersions(courseId: string) {
  await requireAdmin()
  return db
    .select({
      id: contracts.id,
      version: contracts.version,
      status: contracts.status,
      sentAt: contracts.sentAt,
      signedAt: contracts.signedAt,
      signedName: contracts.signedName,
      signedLocale: contracts.signedLocale,
      signedIp: contracts.signedIp,
      signedUserAgent: contracts.signedUserAgent,
      signedTextSha256: contracts.signedTextSha256,
      voidedAt: contracts.voidedAt,
      hasText: sql<boolean>`${contracts.signedText} is not null`,
    })
    .from(contracts)
    .where(eq(contracts.courseId, courseId))
    .orderBy(asc(contracts.version))
}

export type ContractVersion = Awaited<ReturnType<typeof listContractVersions>>[number]

/**
 * The text of one contract version for the admin view: the exact signed text
 * when it was signed, otherwise the text as it would be signed today (in `locale`).
 */
export async function getContractText(
  contractId: string,
  locale: Locale,
): Promise<{ text: string; locale: Locale; signed: boolean }> {
  await requireAdmin()
  const [row] = await db
    .select({ signedText: contracts.signedText, signedLocale: contracts.signedLocale })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1)
  if (row?.signedText) {
    const signedLocale = (["fa", "tr", "en"] as const).find((l) => l === row.signedLocale) ?? locale
    return { text: row.signedText, locale: signedLocale, signed: true }
  }
  return { text: await renderContract(contractId, locale), locale, signed: false }
}
