import "server-only"
import { asc, eq, sql } from "drizzle-orm"

import { db } from "@/db"
import { contracts, type Locale } from "@/db/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { renderContract } from "./render"
import { checkSignedText, recordedSignatureHashes, type SignedTextCheck } from "./signed-text"

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
 * when it was signed (stored encrypted: it contains the ID number; decrypted
 * here, on the server, for admins only), otherwise the text as it would be
 * signed today (in `locale`). A signed text comes with `check`: whether it
 * matches its SHA-256 and the hash recorded in the audit log when it was
 * signed (`checkSignedText`); `text` is empty when it can't be decrypted.
 */
export async function getContractText(
  contractId: string,
  locale: Locale,
): Promise<{ text: string; locale: Locale; signed: boolean; check: SignedTextCheck | null }> {
  await requireAdmin()
  const [row] = await db
    .select({ signedText: contracts.signedText, signedLocale: contracts.signedLocale, signedTextSha256: contracts.signedTextSha256 })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1)
  if (row?.signedText) {
    const signedLocale = (["fa", "tr", "en"] as const).find((l) => l === row.signedLocale) ?? locale
    const { text, check } = checkSignedText(row.signedText, row.signedTextSha256, await recordedSignatureHashes(contractId))
    return { text: text ?? "", locale: signedLocale, signed: true, check }
  }
  return { text: await renderContract(contractId, locale), locale, signed: false, check: null }
}
