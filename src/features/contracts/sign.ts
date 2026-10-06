import "server-only"
import { eq, sql } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db"
import { contracts, courses } from "@/db/schema"
import { audit } from "@/lib/audit"
import { encrypt, sha256 } from "@/lib/crypto"
import { errorForLog, UserError } from "@/lib/errors"
import { sendContractSigned } from "./notify"
import { renderContract } from "./render"

const input = z.object({
  contractId: z.uuid(),
  instructorId: z.uuid(),
  signedName: z.string().trim().min(2).max(200),
  ip: z.string().trim().max(100).nullable(),
  userAgent: z.string().trim().nullable(),
  locale: z.enum(["fa", "tr", "en"]),
})

export type SignResult = { contractId: string; courseId: string; sha256: string; adminsNotified: number }

/**
 * The instructor signs a contract (called by the instructor panel, phase 2,
 * after its own login check). Only the instructor of the contract can sign,
 * only a contract that is still "sent", and only while the workshop awaits
 * the signature. Stores the exact text signed (in `locale`), encrypted like
 * the ID number it contains (`lib/crypto.ts`), the SHA-256 of the plain text
 * and the evidence (name typed, time, IP, browser). The workshop is then
 * published, or confirmed again when the go decision was already taken (a
 * contract re-issued after it keeps that decision and its final number), and
 * the super admins are told. Expected failures throw `UserError("contracts.errors.*")`.
 */
export async function signContract(
  contractId: string,
  instructorId: string,
  signedName: string,
  ip: string | null,
  userAgent: string | null,
  locale: string,
): Promise<SignResult> {
  const parsed = input.safeParse({ contractId, instructorId, signedName, ip, userAgent, locale })
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    throw new UserError(field === "signedName" ? "contracts.errors.nameRequired" : "contracts.errors.notFound", {
      field: field === "signedName" ? "signedName" : undefined,
    })
  }
  const v = parsed.data

  const result = await db.transaction(async (tx) => {
    // Lock the workshop first, then the contract (same order as editing a workshop).
    const [{ courseId } = { courseId: null }] = await tx
      .select({ courseId: contracts.courseId })
      .from(contracts)
      .where(eq(contracts.id, v.contractId))
    if (!courseId) throw new UserError("contracts.errors.notFound")
    const [course] = await tx
      .select({ status: courses.status, finalParticipants: courses.finalParticipants })
      .from(courses)
      .where(eq(courses.id, courseId))
      .for("update")
    const [contract] = await tx.select().from(contracts).where(eq(contracts.id, v.contractId)).for("update")
    if (!course || !contract || contract.instructorId !== v.instructorId) throw new UserError("contracts.errors.notFound")
    if (contract.status === "signed") throw new UserError("contracts.errors.alreadySigned")
    if (contract.status === "void") throw new UserError("contracts.errors.replaced")
    if (course.status !== "awaiting_signature") throw new UserError("contracts.errors.notSignable")

    const text = await renderContract(v.contractId, v.locale, { tx })
    const hash = sha256(text)
    const now = new Date()
    await tx
      .update(contracts)
      .set({
        status: "signed",
        signedAt: now,
        signedName: v.signedName,
        signedLocale: v.locale,
        signedText: encrypt(text),
        signedTextSha256: hash,
        signedIp: v.ip,
        signedUserAgent: v.userAgent?.slice(0, 500) || null,
      })
      .where(eq(contracts.id, v.contractId))
    await tx
      .update(courses)
      .set({
        status: course.finalParticipants === null ? "published" : "confirmed",
        publishedAt: sql`coalesce(${courses.publishedAt}, ${now})`,
        updatedAt: now,
      })
      .where(eq(courses.id, courseId))
    await audit(
      {
        adminId: null,
        action: "contract.sign",
        entity: "contract",
        entityId: v.contractId,
        data: { courseId, version: contract.version, instructorId: v.instructorId, locale: v.locale, sha256: hash },
      },
      tx,
    )
    return { contractId: v.contractId, courseId, sha256: hash }
  })

  const adminsNotified = await sendContractSigned(result.contractId).catch((err) => {
    console.error("[contracts] contract_signed emails failed", errorForLog(err))
    return 0
  })
  return { ...result, adminsNotified }
}
